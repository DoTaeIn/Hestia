"use client";
import { useState } from "react";
import { clearOwnRecovery, ownRecoveryKeys } from "@/lib/browser-recovery";
export default function RecoveryControls({ userId }: { userId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  function exportData() {
    try {
      const rows = ownRecoveryKeys(localStorage,userId).map(key => ({ key, value: localStorage.getItem(key) }));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version:1, rows },null,2)], { type:"application/json" }));
      const link = document.createElement("a"); link.href=url; link.download="hestia-private-recovery.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
      setMessage(`${rows.length}개 복구 항목을 내보냈습니다. 파일에는 문서 내용이 포함될 수 있습니다.`);
    } catch { setMessage("브라우저 저장소에 접근하지 못했습니다."); }
  }
  return <section className="security-block"><h2>이 브라우저의 복구 자료</h2><p className="security-muted">미전송 편집과 제목 초안이 이 브라우저에 남을 수 있습니다. 공용 기기에서는 필요한 내용을 내보낸 뒤 지워주세요. 다운로드한 복구 파일은 개인 문서처럼 보관하세요.</p><button type="button" className="ctl" onClick={exportData}>복구 자료 내보내기</button> <button type="button" className="ctl" onClick={() => setConfirm(true)}>복구 자료 삭제</button>{confirm && <div className="security-confirm"><p>서버에 저장하지 못한 내용은 삭제 후 복원할 수 없습니다. 필요한 자료를 내보냈나요?</p><button type="button" className="ctl" onClick={() => { try { setMessage(`${clearOwnRecovery(localStorage,userId)}개 복구 항목을 지웠습니다.`); } catch { setMessage("브라우저 저장소를 지우지 못했습니다."); } setConfirm(false); }}>이 계정의 복구 자료 지우기</button> <button type="button" className="ctl" onClick={() => setConfirm(false)}>취소</button></div>}{message && <p role="status">{message}</p>}</section>;
}
