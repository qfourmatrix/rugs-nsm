import { AlertTriangle, CheckCircle2, Circle, LoaderCircle, XCircle } from "lucide-react";
import type { JobRecord } from "../../shared/types";
import { formatDateTime } from "../utils";

interface JobLogProps {
  jobs: JobRecord[];
  onCancelJob: (jobId: string) => void;
}

export function JobLog({ jobs, onCancelJob }: JobLogProps) {
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
              : `${jobs.length} product jobs - ${runningCount} active - ${failedCount} failed`}
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
              Showing {visibleJobs.length} of {jobs.length} jobs
            </li>
          ) : null}
        </ol>
      )}
    </section>
  );
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
