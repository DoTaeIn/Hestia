"use client";
import { useRouter } from "next/navigation";
export default function RefreshButton() { const router = useRouter(); return <button type="button" className="ctl" onClick={() => router.refresh()}>새로고침</button>; }
