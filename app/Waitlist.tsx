import Link from "next/link";
import { ArrowRight } from "./icons";

/** Preview is open: collect no unauthenticated emails on the app filesystem. */
export default function Waitlist({ id }: { id?: string }) {
  return <div className="waitlist" id={id}><div className="waitlist-row"><Link className="btn btn-amber" href="/login">Preview 시작하기<ArrowRight size={16} /></Link></div><p className="waitlist-msg">대기자 등록 없이 로그인해서 시작할 수 있습니다.</p></div>;
}
