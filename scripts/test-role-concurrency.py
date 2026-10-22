"""Local-only regression: a demoted admin cannot mutate members after waiting on a lock."""
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_Confluence"
labels = json.loads(subprocess.check_output(["docker", "inspect", "-f", "{{json .Config.Labels}}", CONTAINER], text=True))
assert labels.get("com.supabase.cli.workdir") == str(ROOT), "Refusing an unrelated database"
owner, admin, member, newcomer, workspace = [str(uuid.uuid4()) for _ in range(5)]
command = ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]

def run(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, timeout=15)

def authenticated(user, sql):
    return "begin; set local role authenticated; select set_config('request.jwt.claims', '" + json.dumps({"sub": user, "role": "authenticated"}) + "', true); " + sql + "; commit;"

try:
    setup = run(f"""
      insert into auth.users(id,email) values
       ('{owner}','{owner}@audit.invalid'),('{admin}','{admin}@audit.invalid'),
       ('{member}','{member}@audit.invalid'),('{newcomer}','{newcomer}@audit.invalid');
      insert into public.workspaces(id,name,slug,owner_id) values ('{workspace}','Role concurrency','{workspace}','{owner}');
      insert into public.workspace_members(workspace_id,user_id,role) values ('{workspace}','{admin}','admin'),('{workspace}','{member}','editor');
    """)
    assert setup.returncode == 0, setup.stderr
    sql = "set application_name='hestia-security-role-lock'; " + authenticated(owner, f"select public.set_workspace_member_role('{workspace}','{admin}','viewer'); select pg_sleep(1.5)")
    lock_holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lock_holder.stdin.write(sql)
    lock_holder.stdin.close()
    for _ in range(100):
        state = run("select count(*) from pg_stat_activity where application_name='hestia-security-role-lock' and wait_event='PgSleep'")
        if state.stdout.strip() == "1":
            break
        time.sleep(.02)
    else:
        raise AssertionError("lock holder never reached its deterministic barrier")
    attempt = run(authenticated(admin, f"select public.invite_workspace_member('{workspace}','{newcomer}@audit.invalid','editor')"))
    lock_holder.wait(timeout=10)
    assert lock_holder.returncode == 0, lock_holder.stderr.read()
    assert attempt.returncode != 0 and "Not allowed to manage" in attempt.stderr, attempt.stderr
    result = run(f"select count(*) from public.workspace_members where workspace_id='{workspace}' and user_id='{newcomer}'")
    assert result.stdout.strip() == "0", result.stdout
    print("PASS: member mutation waited for demotion and rejected the former admin; no membership was created.")
finally:
    cleanup = run(f"delete from public.workspaces where id='{workspace}'; delete from auth.users where id in ('{owner}','{admin}','{member}','{newcomer}')")
    assert cleanup.returncode == 0, cleanup.stderr
