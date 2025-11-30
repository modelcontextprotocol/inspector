# Inspector V2 Brief 

### Brief | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_tech_stack.md) | [V2 UX](v2_ux.md)

## Table of Contents
  * [Motivation and Context](#motivation-and-context)
  * [Track Protocol Conformance](#track-protocol-conformance)
  * [Improve Maintainability](#improve-maintainability)
  * [Provide Extensibility](#provide-extensibility)
  * [Proper Documentation](#proper-documentation)

## Motivation and Context

The existing Inspector is hard to maintain for a number of reasons. We decided to create a more maintainable Inspector 
from the ground up, that retains the deterministic boundary of operation, but exposes a plugin architecture.

## Track Protocol Conformance
  * Identify any gaps in V1 inspector
  * Track which features are covered
  * Implement to parity and fill gaps
  * Provide conformance testing in CI

## Improve Maintainability
  * Clearer separation of concerns
  * Smaller, reusable components

## Provide Extensibility
  * Plugin SDK / API 
  * Third parties cand develop/maintain their own plugins for features such as
    * LLM usage
    * Evals
    * Multiple server connections
    * Apps playground
    * Testing of registry configuration 
    * Interface with registry

## Proper Documentation
  * One big README won't cut it anymore
  * Published documentation in MDX should
    * Render in style of spec 
    * Kept up to date
    * Cover all features
    * Discuss troubleshooting strategies
    * Provide detailed contribution guidance that explains architecture and expected idioms
    
