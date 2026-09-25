# Players vs Roster Behavior

TipIn separates player data into two layers:

1. Players Page (global identity)
2. Roster Page (team-specific identity)

Each page controls different fields and behaves differently.

---

## Players Page (Global Player Identity)

Purpose:  
Manages who the player is across the entire organization.

Editable fields (Players table):

- firstName
- lastName
- grade
- shoots
- position
- jerseyNumber
- status

Other behaviors:

- Controls team assignment (PlayerTeams)
- Shows all teams the player belongs to
- Drives global DTO used across the system

Players Page does NOT control:

- rosterPosition
- rosterJerseyNumber (except via sync)
- gamedayStatus
- lineNumber
- captain flags
- goalie flag
- team-specific notes

---

## Roster Page (Team-Specific Player Identity)

Purpose:  
Manages who the player is for a specific team.

Editable fields (RosterEntries table):

- rosterPosition
- rosterJerseyNumber
- gamedayStatus
- lineNumber
- isCaptain
- isAssistantCaptain
- isGoalie
- isActive
- notes

Other behaviors:

- Drives lineup cards
- Drives Game Manager
- Reflects PlayerTeams assignments

Roster Page does NOT control:

- firstName
- lastName
- grade
- shoots
- position
- status
- team assignment

---

## Sync Rules Between Pages

Players → RosterEntries:

- jerseyNumber → rosterJerseyNumber

RosterEntries → Players:

- rosterJerseyNumber → jerseyNumber

PlayerTeams → RosterEntries:

- Adding a team creates a roster entry
- Removing a team deletes the roster entry

No other fields sync.

---

## Summary

Players Page = global identity  
Roster Page = team-specific identity

Jersey number syncs both ways.  
Team assignment syncs one way.  
All other fields are independent.
