# Regent Voting System - Project Overview

## 1. Project Purpose
This project is a web-based university election platform designed to manage and run student elections digitally.

It allows administrators to:
- Create and schedule elections
- Assign candidates per election
- Assign eligible students per election
- Activate elections when setup is complete
- View election history and analytics

It allows students to:
- Log in securely
- View active elections
- Vote for candidates based on positions
- See election outcomes after voting closes

The system is intended to improve transparency, reduce manual election workload, and provide a structured election process for academic institutions.

## 2. Target Users
- Admin users (lecturers, election officers, student affairs staff)
- Student voters

## 3. Core Features
### Admin Features
- Admin authentication and authorization
- Student management (add/edit/delete/import)
- Position management (create/edit/delete election posts)
- Candidate management (assign candidates to positions)
- Election lifecycle management:
  - Create election (starts as draft)
  - Assign candidates
  - Assign eligible students
  - Save eligibility to activate election
- Election history:
  - Winners by position
  - Turnout statistics (voted vs not voted)
  - Candidate vote status
  - Vote activity logs
- Election deletion (with confirmation)

### Student Features
- Student login with institutional identity details
- Access to active elections only
- Position-based voting flow
- Vote submission and status handling

## 4. Election Workflow Implemented
1. Admin creates an election (status = draft)
2. Admin selects candidates for that election
3. Admin selects eligible students for that election
4. On saving eligibility, election status becomes active
5. Students can vote during the active period
6. Admin can view history, turnout, and results

## 5. Technical Stack
- Frontend: HTML, CSS, JavaScript (Vanilla JS)
- Backend/Data: Supabase (PostgreSQL + Auth + REST)
- Data Model: Multi-election schema with mapping tables for:
  - elections
  - election_candidates
  - election_eligible_students
  - election_positions
  - votes linked to election_id

## 6. Project Structure Summary
- admin/: Admin pages and election control pages
- student/: Student dashboard and voting pages
- js/: Business logic for admin and student workflows
- css/: Shared and role-specific styling
- schema.sql and migration SQL files: Database structure and migration scripts

## 7. Academic Value
This project demonstrates practical application of:
- Role-based access control
- Relational database design
- CRUD operations and workflow orchestration
- Election state management (draft, active, ended)
- UI/UX for multi-step administrative processes
- Integration of frontend interfaces with cloud backend services

## 8. Current Status
The system supports a complete multi-election management workflow with per-election candidate and student assignment, activation flow, and historical analytics.

It is suitable as a real-world software engineering project for university administration use-cases.
