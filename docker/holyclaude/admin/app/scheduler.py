from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = BackgroundScheduler(timezone="Asia/Seoul")

JOB_ID = "poll_suggestions_p2"


def _p2_job():
    import subprocess, sys
    subprocess.run(
        [sys.executable, "/workspace/scripts/poll_suggestions.py"],
        capture_output=True,
    )


def add_p2_job(cron_expr: str) -> None:
    remove_p2_job()
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Invalid cron expression: {cron_expr!r}")
    minute, hour, day, month, day_of_week = parts
    trigger = CronTrigger(
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
    )
    scheduler.add_job(_p2_job, trigger, id=JOB_ID, replace_existing=True)


def remove_p2_job() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)


def get_jobs() -> list[dict]:
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger": str(job.trigger),
        })
    return jobs
