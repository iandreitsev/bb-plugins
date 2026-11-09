import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRealtime, useRpc, useBbNavigate, type ExperimentalCodeFenceRendererProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Run } from "./server";
import "./style.css";

function RunnableBlock({ code, language, status, index, message, Original }: ExperimentalCodeFenceRendererProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const block = { threadId: message.threadId, messageId: message.id, language: language as "bash" | "sh" | "shell" | "zsh", index };
  const identity = JSON.stringify(block);
  const [run, setRun] = useState<Run | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const request = useRef<string | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const readVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readVersion.current++; }; }, []);
  const refresh = useCallback(() => {
    if (busy.current) return;
    const version = ++readVersion.current;
    const current = () => alive.current && !busy.current && version === readVersion.current;
    rpc.call("get", JSON.parse(identity)).then(value => { if (current()) setRun(value); }, cause => { if (current()) setError(String(cause)); });
  }, [rpc, identity]);
  useEffect(refresh, [refresh]);
  useRealtime("runs-changed", refresh);
  const running = run?.state === "starting" || run?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [running, refresh]);
  async function execute() {
    if (busy.current || running || status !== "closed") return;
    busy.current = true; readVersion.current++; setPending(true); setError("");
    request.current ??= crypto.randomUUID();
    try {
      const result = await rpc.call("start", { block, code, requestId: request.current });
      if (alive.current) setRun(result);
      request.current = null;
    } catch (cause) { if (alive.current) setError(String(cause)); }
    finally { busy.current = false; if (alive.current) { setPending(false); refresh(); } }
  }
  async function stop() {
    if (!run || busy.current) return;
    busy.current = true; readVersion.current++; setPending(true); setError("");
    try { const value = await rpc.call("stop", { block, runId: run.id }); if (alive.current) setRun(value); }
    catch (cause) { if (alive.current) setError(String(cause)); }
    finally { busy.current = false; if (alive.current) { setPending(false); refresh(); } }
  }
  const labels = { starting: "Запуск…", running: "Выполняется…", succeeded: "Выполнено", failed: "Ошибка", stopped: "Остановлено", unknown: "Результат неизвестен" };
  return <div className="cbr-block">
    <Original />
    <button type="button" className="cbr-play" disabled={pending || status !== "closed" || !code.trim()}
      aria-label={running ? "Остановить команду" : "Выполнить команду"}
      title={status !== "closed" ? "Дождитесь завершения блока кода" : running ? "Остановить команду" : "Выполнить команду в папке этого треда"}
      onClick={running ? stop : execute}>
      {pending ? "…" : <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{running ? <rect x="3" y="3" width="10" height="10" rx="1" /> : <path d="M4 2.5v11L13 8Z" />}</svg>}
    </button>
    {error ? <p role="alert" className="cbr-error">{error}</p> : null}
    {run ? <div className="cbr-result" aria-live="polite">
      <div className="cbr-status"><span>{labels[run.state]}{run.exitCode !== null ? ` · код ${run.exitCode}` : ""}</span>
        <span>{run.notified ? "Агент уведомлён" : !running ? "Уведомляю агента…" : ""}</span>
        {run.terminalId && running ? <button type="button" onClick={() => {
          navigate.experimental_openTerminal({ terminalId: run.terminalId! }).then(opened => { if (!opened) setError("Терминал недоступен в этой панели."); }, cause => setError(String(cause)));
        }}>Открыть терминал</button> : null}
      </div>
      {run.cwd ? <div className="cbr-location">{run.cwd}</div> : null}
      {run.error ? <p className="cbr-error">{run.error}</p> : null}
      {run.notificationError ? <p className="cbr-error">Не удалось уведомить агента; повторяю отправку.</p> : null}
      {run.output ? <details open={run.state === "failed"}><summary>Вывод команды</summary><pre>{run.output}</pre></details> : null}
    </div> : null}
  </div>;
}
export default definePluginApp(app => {
  app.slots.experimental_codeFenceRenderer({ id: "shell-runner", languages: ["bash", "sh", "shell", "zsh"], component: RunnableBlock });
});
