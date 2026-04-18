import asyncio
import csv
import sys
from pathlib import Path

from bs4 import BeautifulSoup

_LOCUSTFILE = "/tmp/locust_stress.py"
_CSV_PREFIX = "/tmp/locust_results"
_CSV_STATS = "/tmp/locust_results_stats.csv"

_LOCUSTFILE_CONTENT = """\
from locust import HttpUser, task, between
from random import randint, choice

PLAYERS = [f"player_{i}" for i in range(1, 51)]

class StressUser(HttpUser):
    wait_time = between(0.1, 0.3)

    @task(8)
    def get_leaderboard(self):
        self.client.get("/leaderboard")

    @task(2)
    def get_info(self):
        self.client.get("/info")

    @task(2)
    def add_score(self):
        self.client.post("/add", json={
            "player_name": choice(PLAYERS),
            "rating": randint(0, 5000)
        })

    @task(1)
    def get_history(self):
        self.client.get(f"/history?player_name={choice(PLAYERS)}")
"""

# JavaScript injected into the HTML report to reorder sections after React renders.
# Locust renders: Request Statistics → Charts → Final ratio (all siblings in one parent).
# We move Charts and Final ratio before Request Statistics so charts appear first.
_REORDER_SCRIPT = """
(function () {
  function reorder() {
    var h2s = document.querySelectorAll('h2');
    if (!h2s.length) return false;
    var sections = {};
    h2s.forEach(function (h2) {
      sections[h2.textContent.trim()] = h2.parentElement;
    });
    var chartsSection = sections['Charts'];
    var statsSection  = sections['Request Statistics'];
    var ratioSection  = sections['Final ratio'];
    if (!chartsSection || !statsSection) return false;
    var parent = chartsSection.parentElement;
    if (!parent || parent !== statsSection.parentElement) return false;
    // Charts first
    parent.insertBefore(chartsSection, statsSection);
    // Final ratio directly after charts, still before stats
    if (ratioSection && ratioSection.parentElement === parent) {
      parent.insertBefore(ratioSection, statsSection);
    }
    return true;
  }

  var root = document.getElementById('root');
  if (root) {
    var observer = new MutationObserver(function (mutations, obs) {
      if (document.querySelector('h2') && reorder()) {
        obs.disconnect();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }
  // Fallback for already-rendered content
  window.addEventListener('load', function () { setTimeout(reorder, 200); });
})();
"""

_EXACT_NAMES = {"/add", "/leaderboard", "/info", "/history", "Aggregated"}


def _matches(name: str) -> bool:
    if name in _EXACT_NAMES:
        return True
    if name.startswith("/history"):
        return True
    return False


def _canonical_name(name: str) -> str:
    if name.startswith("/history"):
        return "/history"
    return name


def reorder_report(html: str) -> str:
    """
    Reorders sections in the Locust HTML report so that:
    1. Charts section appears first
    2. Summary / ratio section appears second
    3. Request statistics table appears last

    The Locust report is a React SPA rendered at runtime — there is no static HTML
    to rearrange. Instead, we inject a script that uses MutationObserver to wait for
    React to mount, then reorders sibling section divs by their h2 heading text.
    """
    soup = BeautifulSoup(html, "html.parser")
    script_tag = soup.new_tag("script")
    script_tag.string = _REORDER_SCRIPT
    body = soup.find("body")
    if body:
        body.append(script_tag)
    return str(soup)


async def run_stress_test(
    host: str,
    users: int,
    spawn_rate: int,
    run_time_seconds: int,
) -> dict:
    Path(_LOCUSTFILE).write_text(_LOCUSTFILE_CONTENT)

    locust_bin = str(Path(sys.executable).parent / "locust")
    cmd = [
        locust_bin,
        "-f", _LOCUSTFILE,
        "--host", host,
        "--headless",
        "--users", str(users),
        "--spawn-rate", str(spawn_rate),
        "--run-time", f"{run_time_seconds}s",
        "--csv", _CSV_PREFIX,
        "--csv-full-history",
        "--html", "/tmp/locust_report.html",
        "--exit-code-on-error", "0",
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )

    timeout = run_time_seconds + 30
    try:
        await asyncio.wait_for(proc.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {"status": "error", "message": f"Locust timed out after {timeout}s"}

    try:
        with open(_CSV_STATS, newline="") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except Exception:
        return {"status": "error", "message": "Could not parse locust results"}

    # Aggregate all /history?... rows into a single /history entry
    history_combined: dict = {}
    filtered = []
    for r in rows:
        name = r.get("Name", "")
        if not _matches(name):
            continue
        if name.startswith("/history") and name != "/history":
            if not history_combined:
                history_combined = dict(r)
                history_combined["Name"] = "/history"
            else:
                try:
                    history_combined["Request Count"] = str(
                        int(history_combined["Request Count"]) + int(r["Request Count"])
                    )
                    history_combined["Failure Count"] = str(
                        int(history_combined["Failure Count"]) + int(r["Failure Count"])
                    )
                except (KeyError, ValueError):
                    pass
        else:
            filtered.append(r)

    if history_combined:
        filtered.append(history_combined)

    if not filtered:
        return {"status": "error", "message": "Could not parse locust results"}

    results = []
    for row in filtered:
        try:
            req = int(row["Request Count"])
            fail = int(row["Failure Count"])
            results.append({
                "endpoint": row["Name"],
                "requests": req,
                "failures": fail,
                "failure_pct": round(fail / max(req, 1) * 100, 1),
                "p50_ms": float(row["Median Response Time"]),
                "p95_ms": float(row["95%"]),
                "p99_ms": float(row["99%"]),
                "avg_ms": float(row["Average Response Time"]),
                "min_ms": float(row["Min Response Time"]),
                "max_ms": float(row["Max Response Time"]),
                "rps": float(row["Requests/s"]),
            })
        except (KeyError, ValueError):
            return {"status": "error", "message": "Could not parse locust results"}

    try:
        with open("/tmp/locust_report.html", "r", encoding="utf-8") as f:
            html_report = f.read()
        html_report = reorder_report(html_report)
        with open("/tmp/locust_report.html", "w", encoding="utf-8") as f:
            f.write(html_report)
    except Exception:
        html_report = None

    return {
        "status": "completed",
        "config": {
            "users": users,
            "spawn_rate": spawn_rate,
            "run_time_seconds": run_time_seconds,
            "host": host,
        },
        "results": results,
        "html_report": html_report,
    }
