"""Typer CLI for the linkedin-finder package.

Subcommands:
    login    open Playwright Chrome window so user can log into LinkedIn once
    daily    run the full discovery -> draft pipeline
    ui       launch the Streamlit dashboard
    setup    install/uninstall macOS launchd schedule
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from .config import load_config
from .discovery.linkedin_session import browser_context, is_logged_in

app = typer.Typer(no_args_is_help=True, help="LinkedIn Job Finder")
console = Console()

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@app.command()
def login() -> None:
    """Open a Chromium window with the persistent profile so you can log into LinkedIn."""
    cfg = load_config()
    console.print(f"[cyan]Opening Chrome with profile at {cfg.browser_profile_dir}[/]")
    console.print("[yellow]Log into linkedin.com in the window that opens, then close it.[/]")
    with browser_context(cfg.browser_profile_dir, headless=False) as ctx:
        page = ctx.new_page()
        page.goto("https://www.linkedin.com/feed/")
        console.print("[green]Window open. Close it when you're done logging in.[/]")
        try:
            # Block until the user closes all pages.
            while ctx.pages:
                page.wait_for_timeout(2000)
        except Exception:
            pass


@app.command()
def check_session() -> None:
    """Verify the persistent profile is still logged into LinkedIn."""
    cfg = load_config()
    with browser_context(cfg.browser_profile_dir, headless=True) as ctx:
        page = ctx.new_page()
        try:
            if is_logged_in(page):
                console.print("[green]LinkedIn session OK[/]")
                raise typer.Exit(code=0)
            else:
                console.print("[red]Not logged in. Run `linkedin-finder login`[/]")
                raise typer.Exit(code=1)
        finally:
            page.close()


@app.command()
def daily(headless: bool = True) -> None:
    """Run the daily pipeline: discover jobs, score, find recruiters, draft messages."""
    from .daily import run_daily

    summary = run_daily(headless=headless)
    table = Table(title="Daily run summary")
    table.add_column("metric")
    table.add_column("value", justify="right")
    table.add_row("new jobs", str(summary.new_jobs))
    table.add_row("qualified jobs", str(summary.qualified_jobs))
    table.add_row("new contacts", str(summary.new_contacts))
    table.add_row("new drafts", str(summary.new_drafts))
    table.add_row("errors", str(len(summary.errors)))
    console.print(table)
    if summary.errors:
        console.print("[red]Errors:[/]")
        for e in summary.errors:
            console.print(f"  - {e}")


@app.command()
def ui() -> None:
    """Launch the Streamlit dashboard."""
    app_path = Path(__file__).parent / "ui" / "app.py"
    subprocess.run(
        [sys.executable, "-m", "streamlit", "run", str(app_path)],
        check=False,
    )


@app.command()
def install_schedule() -> None:
    """Install the macOS launchd schedule for daily runs."""
    script = PROJECT_ROOT / "scripts" / "install_launchd.sh"
    if not script.exists():
        console.print(f"[red]Missing {script}[/]")
        raise typer.Exit(code=1)
    subprocess.run(["bash", str(script)], check=False)


@app.command()
def uninstall_schedule() -> None:
    """Uninstall the macOS launchd schedule."""
    script = PROJECT_ROOT / "scripts" / "uninstall_launchd.sh"
    if not script.exists():
        console.print(f"[red]Missing {script}[/]")
        raise typer.Exit(code=1)
    subprocess.run(["bash", str(script)], check=False)


if __name__ == "__main__":
    app()
