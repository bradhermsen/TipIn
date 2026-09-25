# TipIn System Security

TipIn uses a role‑based security model designed for youth hockey, high school hockey, and future tournament expansion. This document defines all roles, permissions, access rules, access code behavior, and session security.

---

# 1. Overview

TipIn separates responsibilities across several roles:

- SuperAdmin
- OrgAdmin
- Team Manager
- Coach
- Game Manager (formerly Scorekeeper)
- Stat Manager (optional)
- Viewer

Game Manager and Stat Manager authenticate using **Access Codes** generated at the team level. Coaches and Team Managers handle day‑to‑day team operations. OrgAdmins oversee the entire organization.

---

# 2. User Roles

## SuperAdmin

System‑wide access across all organizations.

## OrgAdmin

Organization‑level administrator (Athletic Director, Program Director).  
Full access for their organization, but not responsible for daily team operations.

## Team Manager

Day‑to‑day team operations for assigned team(s).  
Handles schedules, external opponents, rosters, and access code generation.

## Coach

Team‑level coaching operations for assigned team(s).  
Handles player development, roster decisions, and gameday lineup.

## Game Manager

Unified role (formerly Scorekeeper).  
Handles game flow and game stats on game day using Access Code.

## Stat Manager (Optional)

Stats‑only role for organizations that want separate stat entry from game flow.

## Viewer

Read‑only access.

---

# 3. Role Responsibilities

## SuperAdmin

- Full CRUD across all organizations
- Manage global settings
- Manage all teams, players, rosters, schedules
- Manage tournaments, officials, media outlets

## OrgAdmin

- Full CRUD within their organization
- Manage teams, players, rosters, schedules
- Manage external teams for their organization
- Manage organization‑level settings
- Does NOT handle daily team operations

## Team Manager

- Manage schedules for assigned team(s)
- Add/edit games
- Add external opponents
- Add external rosters
- Manage roster entries
- Manage team players
- Generate Access Codes (GM‑XXXXXX, SM‑XXXXXX)
- Prepare gameday roster
- Load pre‑scheduled game into Game Manager app

## Coach

- Manage roster for assigned team(s)
- Manage players for assigned team(s)
- Manage gameday roster
- Manage line assignments
- Read‑only or full schedule access (org setting)
- May also be assigned Team Manager role if needed

## Game Manager

- Access via Access Code
- Load pre‑scheduled game
- Manage game flow
- Enter scoring events
- Enter penalties
- Enter goalie changes
- Enter shots, hits, blocks
- Enter faceoff stats
- Enter goalie stats
- Access begins game day
- Access expires 2 hours after game marked final

## Stat Manager (Optional)

- Access via Access Code
- Stats‑only role
- No game flow control
- Same expiration rules as Game Manager

## Viewer

- Read‑only access to public pages
- No editing permissions

---

# 4. Access Matrix

## Players Page

| Role         | Access                          |
| ------------ | ------------------------------- |
| SuperAdmin   | Full CRUD                       |
| OrgAdmin     | Full CRUD                       |
| Team Manager | Full CRUD (assigned teams only) |
| Coach        | Full CRUD (assigned teams only) |
| Game Manager | No access                       |
| Stat Manager | No access                       |
| Viewer       | No access                       |

## Rosters

| Role         | Access                          |
| ------------ | ------------------------------- |
| SuperAdmin   | Full CRUD                       |
| OrgAdmin     | Full CRUD                       |
| Team Manager | Full CRUD (assigned teams only) |
| Coach        | Full CRUD (assigned teams only) |
| Game Manager | No access                       |
| Stat Manager | No access                       |
| Viewer       | Read‑only                       |

## Schedules

| Role         | Access                               |
| ------------ | ------------------------------------ |
| SuperAdmin   | Full CRUD                            |
| OrgAdmin     | Full CRUD                            |
| Team Manager | Full CRUD (assigned teams only)      |
| Coach        | Read‑only or Full CRUD (org setting) |
| Game Manager | No access                            |
| Stat Manager | No access                            |
| Viewer       | Read‑only                            |

## External Teams & Rosters

| Role         | Access                    |
| ------------ | ------------------------- |
| SuperAdmin   | Yes                       |
| OrgAdmin     | Yes                       |
| Team Manager | Yes (assigned teams only) |
| Coach        | No                        |
| Game Manager | No                        |
| Stat Manager | No                        |
| Viewer       | No                        |

## Game Manager Tablet App

| Role         | Access                               |
| ------------ | ------------------------------------ |
| Game Manager | Full game control + full stats entry |
| Stat Manager | Stats‑only (optional)                |
| Team Manager | Generates access codes               |
| Coach        | Optional read‑only                   |
| Others       | No access                            |

---

# 5. Access Code System

Access Codes authenticate game‑day roles.

## Code Formats

- Game Manager: `GM-XXXXXX`
- Stat Manager: `SM-XXXXXX`

## Generation Rules

- Generated by Team Manager
- Unique per game
- Unique per team
- New code generated every game day

## Activation Rules

- Valid starting at 12:01 AM on game day
- Valid only for the specific game
- Valid only for the specific team
- Cannot be reused

## Expiration Rules

- Expires automatically 2 hours after game marked final
- Expires after inactivity
- Cannot access Admin pages
- Cannot access Players or Rosters
- Cannot access other games

---

# 6. Session & Authentication Rules

## Token Expiration

- JWT expires in 30 minutes
- Sliding refresh extends active sessions

## Idle Timeout

- 45 minutes of inactivity logs user out

## Route‑Level Authorization

Every page must validate:

- user exists
- user role exists
- user role is allowed for that route

## Storage Rules

- Tokens stored in HttpOnly cookies
- Prevents long‑term persistent login
- Prevents token theft

---

# 7. Team Manager vs Coach

## Team Manager

Handles:

- schedules
- external teams
- external rosters
- access codes
- roster maintenance
- player management
- gameday prep

## Coach

Handles:

- roster decisions
- player development
- gameday lineup
- line assignments
- player status

Coaches may also be assigned Team Manager role if needed.

---

# 8. Game Manager Tablet App Security

## Allowed

- Load pre‑scheduled game
- Manage game flow
- Enter all game stats
- Enter all team stats
- Enter all player stats

## Not Allowed

- Access Admin pages
- Access Players
- Access Rosters
- Access other games
- Access organization settings

## Access Code Enforcement

- Required for every game
- Valid only on game day
- Expires 2 hours after final
- Cannot be reused

---

# 9. External Teams & Rosters

## Allowed Roles

- SuperAdmin
- OrgAdmin
- Team Manager

## Not Allowed

- Coach
- Game Manager
- Stat Manager
- Viewer

Team Managers handle external opponents because they manage schedules and logistics.

---

# 10. Future Expansion Notes

This security model supports future modules:

- Tournament Manager
- Officials Management
- Media Outlet Management
- Multi‑team organizations
- Multi‑role users

The role structure is designed to scale without major changes.

---

# End of TipIn System Security
