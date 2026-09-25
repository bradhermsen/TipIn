# Roster Sync Rules

TipIn uses three layers of player data:

1. Players (global identity)
2. PlayerTeams (team assignment)
3. RosterEntries (team-specific roster data)

Only certain fields sync between these layers. Most fields do not sync.

---

## Players → RosterEntries (Downstream Sync)

When Players.jerseyNumber is updated, all related RosterEntries.rosterJerseyNumber values are updated automatically.

Fields that sync from Players to RosterEntries:

- jerseyNumber

Fields that do NOT sync:

- firstName
- lastName
- grade
- shoots
- position
- status

---

## RosterEntries → Players (Upstream Sync)

When RosterEntries.rosterJerseyNumber is updated, Players.jerseyNumber is updated automatically.

Fields that sync from RosterEntries to Players:

- rosterJerseyNumber

Fields that do NOT sync:

- rosterPosition
- gamedayStatus
- lineNumber
- isCaptain
- isAssistantCaptain
- isGoalie
- isActive
- notes

---

## PlayerTeams → RosterEntries (Assignment Sync)

When a PlayerTeams row is added:

- A new RosterEntries row is created for that team.

When a PlayerTeams row is removed:

- The corresponding RosterEntries row is deleted.

Fields created in a new RosterEntry:

- playerId
- teamId
- rosterJerseyNumber (copied from Players.jerseyNumber)
- rosterPosition (default)
- gamedayStatus (default)
- lineNumber (default)
- captain flags (default)
- goalie flag (default)
- notes (default)

---

## Fields That Never Sync

These fields are team-specific and never sync to Players:

- rosterPosition
- gamedayStatus
- lineNumber
- isCaptain
- isAssistantCaptain
- isGoalie
- isActive
- notes

---

## Summary

Players controls global identity.  
RosterEntries controls team-specific identity.  
PlayerTeams controls assignment.  
Jersey number syncs both ways.  
No other fields sync.
