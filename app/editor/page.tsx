import { redirect } from "next/navigation";

/** /editor has no document of its own — send it to the space it lives in. */
export default function EditorIndex() {
  redirect("/space");
}
