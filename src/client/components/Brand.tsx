import { RoundTableMark } from "../icons";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="圆桌助手">
      <RoundTableMark className="brand__mark" />
      <span>圆桌助手</span>
    </div>
  );
}

export function ConnectionNotice({ connected, error }: { connected: boolean; error: string | null }) {
  if (connected && !error) return null;
  return (
    <div className={`connection-notice ${error ? "connection-notice--error" : ""}`} role="status" aria-live="polite">
      {error ?? "连接中断，正在重新连接…"}
    </div>
  );
}
