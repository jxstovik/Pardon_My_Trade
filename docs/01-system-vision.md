# System Vision

Document ID: FDP-VISION-001  
Status: Draft  
Milestone: Foundation

## Purpose

Pardon My Trade is an Agentic Sports Intelligence Platform. The first supported domain is fantasy football. The second target domain is fantasy baseball. Future sports should be added primarily through adapters, scoring definitions, and sport-specific intelligence modules rather than new core infrastructure.

## Product Goal

Build an autonomous Fantasy Sports General Manager that continuously evaluates league state, player performance, injuries, news, projections, scoring rules, schedule context, and manager tendencies to improve championship probability while keeping a human in control of all league actions.

## Core Tenets

- AI providers are interchangeable.
- Fantasy platforms are interchangeable.
- Sports and scoring systems are configurable.
- Business logic lives in deterministic engines, configuration, and typed models, not prompts.
- Every recommendation is explainable and auditable.
- Initial releases are recommendation-only.
- League actions require explicit human approval.

## Primary Users

- Fantasy football managers who want lineup, waiver, drop, and trade recommendations.
- Advanced managers who want explainable projections and risk analysis.
- Future enterprise users managing multiple leagues or collaborative fantasy operations.

## Initial Product Boundary

The MVP imports a single league, analyzes the roster and league context, and generates recommendations. It does not submit transactions, alter rosters, negotiate trades, message league managers, or make autonomous decisions inside the fantasy platform.

## Success Definition

The system is successful when it produces timely, explainable, configurable recommendations that a human can review and execute manually with confidence.

## Non-Goals For MVP

- Automated league actions.
- Multi-user accounts.
- Real-money betting or gambling optimization.
- Unapproved scraping of fantasy platforms.
- Fully autonomous negotiation.
- A generic chat assistant with hidden business rules in prompts.
