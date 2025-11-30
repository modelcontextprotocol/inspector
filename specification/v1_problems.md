# Inspector V1 Problems

### [Brief](README.md) | V1 Problems | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_tech_stack.md) | [V2 UX](v2_ux.md)

## Table of Contents
  * [Monolithic components](#monolithic-components)
  * [Monolithic hooks](#monolithic-hooks)
  * [Environment variable explosion](#environment-variable-explosion-)
  * [Disparate OAuth flows](#disparate-oauth-flows-)
  * [CLI version combined with UI version](#cli-version-combined-with-ui-version-)

## Monolithic components
  * Hard to read and maintain
  * Deeply custom:
    * Divs all the way down, 
    * Strewn with hundreds of css classes
### Solution
  * Make a kit of small, reusable components that are already styled for use anywhere in the app
    * Easier to reason about than inline-customized primitives
    * Minimize css for inline customization
    * Only pass state
  * Define functions to use as handlers rather than writing inline in code
    * Makes component instantiation markup smaller and easier to understand
    * Separates code from markup 

## Monolithic hooks
  * E.g., `useConnection` is nearly 1k lines long

### Solution
  * Extract inline logic out to function libraries / classes that are easier to reason about and test in isolation

## Environment variable explosion  
  * We have a configuration file but it is for servers, not things like request timeouts, etc  
  * The addition of a new environment variable for everything someone wants to configure is problematic.   
    * It’s easy to misspell the variable name and the names  
    * Often not named in the best way  
    * Lots of touch points to update for a new variable  

### Solution
  * A JSON configuration file would be a better approach.   
    * Hierarchical groups of settings could be used  
    * Different files for different configurations
    * Expanding the format to include other settings   
    * A configuration file could be validated, so misspelled keys would be caught at startup  

## Disparate OAuth flows  
  * We often have deviations of behavior between basic flow, quick flow, and guided flow
  * Each flow has independent code paths that can break or behave differently from the others

### Solution
  * Use a single auth flow mechanism that operates in all three states while supporting different configurations

## CLI version combined with UI version  
  * Both projects are not kept in parity and do not share significant overlap as to belong in the same repo

### Solution
  * Refactor/extract the CLI Inspector to a separate repo for ongoing development


