# Sports tournament results

Playbook for brainstorming mode. Example: `examples/sports-tournament-results/`.

## Detection signals

A `team`, a game date, `goals_for`/`goals_against` or `home_score`/`away_score`, a `result` or `points` column. Grain: one row per team per game (a match has two rows) or one row per match.

## Interview questions

- Who is it for: coach, organiser or fans? Default: organiser.
- Is a row a match or a team-game? Default: ask; a match needs unpivoting to team-games before standings.
- Points rule: 3 for a win, 1 for a draw? Default: that, unless the column exists.
- Tie-breakers for the table (goal difference, head to head)? Default: points, then goal difference.
- Break down by team, round or group? Default: team.

## Figures

```sql
SELECT COUNT(*) AS team_games FROM results;
SELECT COUNT(*) AS wins FROM results WHERE result = 'Win';
SELECT SUM(points) AS points FROM results;
SELECT SUM(goals_for) AS goals_for FROM results;
SELECT SUM(goals_against) AS goals_against FROM results;
SELECT team, SUM(points) AS points, SUM(goals_for) - SUM(goals_against) AS goal_difference FROM results GROUP BY 1 ORDER BY 2 DESC, 3 DESC, 1;
```

## Tile ideas

- KPIs: team-games, wins, points, goals for and against. How did the tournament go?
- `hbar` of points by team. Who leads the table?
- `donut` of results. Wins, draws and losses?
- `line` of goals per day. Is scoring rising?

## Traps

- Match rows versus team-game rows: counting a match row as two teams' games doubles or halves totals.
- Goals for and against over all teams are equal by definition when both sides are listed; a gap means missing rows.
- Teams with fewer games lead on average but not on points; show games played.
- Ties in points need the tie-breaker rule stated before ranking.
- Walkovers and forfeits carry points but no real score.
