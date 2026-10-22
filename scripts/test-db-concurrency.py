"""Concurrency checks against an explicitly labelled, disposable local DB only.

Requires Docker, installed npm dependencies, and migrations through 0020.
No network ports or remote database URLs are used. Fixtures are removed on exit.
"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import threading
import uuid

CONTAINER = "hestia-audit-db"
ROOT = Path(__file__).resolve().parents[1]
OWNER, WORKSPACE, PAGE = [str(uuid.uuid4()) for _ in range(3)]


def execute(sql, authenticated=False, expect_error=False):
    if authenticated:
        sql = ("begin; set local role authenticated; "
               f"set local request.jwt.claim.sub = '{OWNER}'; " + sql + "; commit;")
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-U", "supabase_admin",
         "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=15,
    )
    if expect_error:
        assert result.returncode != 0, "expected the database to reject the operation"
        return result.stderr
    if result.returncode:
        raise RuntimeError(result.stderr)
    return [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]


def node(source, data=None):
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        input=json.dumps(data), cwd=ROOT, capture_output=True, text=True, timeout=10,
    )
    if result.returncode:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)


def race(*queries):
    barrier = threading.Barrier(len(queries))

    def run(query):
        barrier.wait(timeout=5)
        return execute(query, authenticated=True)[0]

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(run, queries))


def append(operation_id, payload):
    return ("select row_to_json(r) from public.append_page_collaboration_update("
            f"'{PAGE}', 1, '{operation_id}', '{payload}') r")


def main():
    label = subprocess.run(
        ["docker", "inspect", "--format", '{{ index .Config.Labels "codex.task" }}', CONTAINER],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if label != "hestia-system-audit":
        raise RuntimeError("Refusing to run against an unlabelled or unrelated database container")

    execute(f"""
      insert into auth.users(id,email) values ('{OWNER}', '{OWNER}@audit.invalid');
      insert into public.workspaces(id,name,slug,owner_id)
        values ('{WORKSPACE}', 'Concurrency audit', '{WORKSPACE}', '{OWNER}');
      set request.jwt.claim.sub = '{OWNER}';
      insert into public.pages(id,workspace_id,title) values ('{PAGE}', '{WORKSPACE}', 'Concurrency audit');
    """)
    try:
        seeds = node("""
          import * as Y from 'yjs';
          console.log(JSON.stringify(['seed A','seed B'].map(text => {
            const doc = new Y.Doc(); doc.getText('body').insert(0,text);
            const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
            doc.destroy(); return state;
          })));
        """)
        seeded = race(*[
            f"select row_to_json(r) from public.seed_page_collaboration('{PAGE}','{state}',1) r; select pg_sleep(0.1)"
            for state in seeds
        ])
        assert sum(row["seeded"] for row in seeded) == 1, seeded
        assert seeded[0]["collaboration_state"] == seeded[1]["collaboration_state"], seeded
        canonical = seeded[0]["collaboration_state"]
        print("PASS: concurrent initializers choose one canonical Yjs seed")

        updates = node("""
          import * as Y from 'yjs'; import {readFileSync} from 'node:fs';
          const state = JSON.parse(readFileSync(0,'utf8'));
          console.log(JSON.stringify(['change A','change B','retry C'].map(text => {
            const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(state,'base64'));
            const vector = Y.encodeStateVector(doc);
            doc.getText('body').insert(doc.getText('body').length, text);
            const update = Buffer.from(Y.encodeStateAsUpdate(doc,vector)).toString('base64');
            doc.destroy(); return update;
          })));
        """, canonical)
        results = race(*[append(str(uuid.uuid4()), payload) for payload in updates[:2]])
        assert all(row["status"] == "appended" for row in results), results
        operation_id = str(uuid.uuid4())
        retried = race(append(operation_id, updates[2]), append(operation_id, updates[2]))
        assert sorted(row["status"] for row in retried) == ["appended", "duplicate"], retried
        error = execute(append(operation_id, updates[0]), authenticated=True, expect_error=True)
        assert "different update" in error, error
        loaded = execute(f"select row_to_json(r) from public.load_page_collaboration('{PAGE}') r", True)[0]
        assert len(loaded["updates"]) == 3, loaded
        text = node("""
          import * as Y from 'yjs'; import {readFileSync} from 'node:fs';
          const data=JSON.parse(readFileSync(0,'utf8')); const doc=new Y.Doc();
          Y.applyUpdate(doc,Buffer.from(data.collaboration_state,'base64'));
          for(const update of data.updates) Y.applyUpdate(doc,Buffer.from(update.payload,'base64'));
          console.log(JSON.stringify(doc.getText('body').toString()));doc.destroy();
        """, loaded)
        assert all(change in text for change in ["change A", "change B", "retry C"]), text
        print("PASS: concurrent deltas and idempotent retries preserve every edit")

        revision = execute(
            f"select row_to_json(r) from public.save_page_version('{PAGE}', 'Recorded', "
            "'{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}'::jsonb, null) r", True,
        )[0]
        restored, appended = race(
            f"select row_to_json(r) from public.restore_page_revision('{PAGE}','{revision['id']}','audit') r; select pg_sleep(0.1)",
            append(str(uuid.uuid4()), updates[0]),
        )
        assert restored["version"] == 2, restored
        assert appended["status"] in ("appended", "stale_generation"), appended
        after = execute(f"select row_to_json(r) from public.load_page_collaboration('{PAGE}') r", True)[0]
        assert after["collaboration_generation"] == 2, after
        assert after["collaboration_state"] is None and after["updates"] == [], after
        print("PASS: a restore racing an append leaves no stale-generation update")
    finally:
        execute(f"delete from public.workspaces where id='{WORKSPACE}'; delete from auth.users where id='{OWNER}';")


if __name__ == "__main__":
    main()
