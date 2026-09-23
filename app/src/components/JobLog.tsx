import { AlertTriangle, CheckCircle2, Circle, LoaderCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { JobRecord } from "../../shared/types";
import { formatDateTime } from "../utils";
import { getJobHistory } from "../api";

interface JobLogProps {
  jobs: JobRecord[];
  onCancelJob: (jobId: string) => void;
  productId?: string;
}

export function JobLog({ jobs, onCancelJob, productId }: JobLogProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const sortedJobs = [...jobs].sort((left, right) => {
    const priorityDelta = jobPriority(right.status) - jobPriority(left.status);
    if (priorityDelta !== 0) return priorityDelta;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
  const visibleJobs = sortedJobs.slice(0, 10);
  const runningCount = jobs.filter((job) => job.status === "queued" || job.status === "generating").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;

  return (
    <section className="jobLogPanel" aria-label="Job log">
      <div className="panelHeader compactHeader">
        <div>
          <h2>Job Log</h2>
          <p>
            {jobs.length === 0
              ? "No jobs for this product"
              : `${runningCount} active · ${failedCount} failed in recent history`}
          </p>
        </div>
      </div>

      {visibleJobs.length === 0 ? (
        <div className="compactEmpty">Queued and completed jobs will appear here.</div>
      ) : (
        <ol className="jobList">
          {visibleJobs.map((job) => (
            <li className={`jobItem status-${job.status}`} key={job.jobId}>
              <span className="jobIcon">{jobIcon(job.status)}</span>
              <div className="jobCopy">
                <strong>{job.message}</strong>
                <span>
                  {job.shotName ?? job.shotId}
                  {job.batchTotal && job.batchTotal > 1
                    ? ` ${job.batchIndex ?? 1}/${job.batchTotal}`
                    : ""}{" "}
                  - {formatDateTime(job.updatedAt)}
                </span>
              </div>
              {job.status === "queued" || job.status === "generating" ? (
                <button
                  className="miniButton"
                  type="button"
                  onClick={() => onCancelJob(job.jobId)}
                >
                  Cancel
                </button>
              ) : null}
            </li>
          ))}
          {jobs.length > visibleJobs.length ? (
            <li className="jobItem jobMore">
              Showing {visibleJobs.length} of {jobs.length} recent and active jobs
            </li>
          ) : null}
        </ol>
      )}
      {productId ? <>
        <button className="miniButton" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}>
          {historyOpen ? "Close job history" : "Browse job history"}
        </button>
        {historyOpen ? <JobHistory productId={productId} /> : null}
      </> : null}
    </section>
  );
}

function JobHistory({ productId }: { productId: string }) {
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);
  const [page, setPage] = useState<{ jobs: JobRecord[]; nextCursor: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const before = cursors.at(-1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setPage(null);
    void getJobHistory(productId, before, controller.signal).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "History could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, before, retry]);
  return <section aria-label="Completed job history" aria-busy={loading}>
    <p role="status">{loading ? "Loading history…" : `History page ${cursors.length} · ${page?.jobs.length ?? 0} completed jobs`}</p>
    {error ? <p role="alert">{error} <button type="button" className="miniButton" onClick={() => setRetry(value => value + 1)}>Retry history</button></p> : null}
    <ol className="jobList">
      {page?.jobs.map(job => <li className={`jobItem status-${job.status}`} key={job.jobId}>
        <span className="jobIcon">{jobIcon(job.status)}</span>
        <div className="jobCopy"><strong>{job.message}</strong><span>{job.shotName ?? job.shotId} · {job.status} · {formatDateTime(job.updatedAt)}</span></div>
      </li>)}
    </ol>
    {!loading && !error && page?.jobs.length === 0 ? <p>No completed jobs for this rug yet.</p> : null}
    <nav aria-label="Job history pages">
      <button type="button" className="miniButton" disabled={loading || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Newer jobs</button>{" "}
      <button type="button" className="miniButton" disabled={loading || page?.nextCursor == null} onClick={() => { if (page?.nextCursor != null) setCursors(values => [...values, page.nextCursor!]); }}>Older jobs</button>
    </nav>
  </section>;
}

function jobPriority(status: JobRecord["status"]) {
  if (status === "generating") return 5;
  if (status === "queued") return 4;
  if (status === "failed") return 3;
  if (status === "cancelled") return 2;
  return 1;
}

function jobIcon(status: JobRecord["status"]) {
  if (status === "queued") {
    return <Circle size={14} />;
  }

  if (status === "generating") {
    return <LoaderCircle className="spin" size={14} />;
  }

  if (status === "succeeded") {
    return <CheckCircle2 size={14} />;
  }

  if (status === "failed") {
    return <AlertTriangle size={14} />;
  }

  return <XCircle size={14} />;
}
