# Inspector V2 Tech Stack

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack | [V2 UX](v2_ux.md)

## Table of Contents
  * [Web Client](#web-client)
      * [Language and Framework](#language-and-framework)
      * [Components and theme](#components-and-theme)
  * [Proxy Server](#proxy-server)
      * [Language and Runtime](#language-and-runtime)
      * [Transport Operation](#server)
      * [Logging](#logging)


## Web Client
### Language and Framework
* Typescript
* React

### Components and Theme
Let's choose a feature-rich component set with easy theming control
* -[ ] [Mantine](https://ui.mantine.dev/)
* -[ ] [Shadcdn](https://ui.shadcn.com/)

## Proxy Server
### Language and Runtime
* Typescript
* Node

### Transport Operation
Let's consider how to operate the server transports.
* -[x] [Express](https://expressjs.com/)
* -[ ] Node:[http](https://nodejs.org/docs/v22.18.0/api/http.html)

### Logging
Let's step up our logging capability with an advanced logger:
* -[ ] [Winston](https://github.com/winstonjs/winston?tab=readme-ov-file#winston)
* -[x] [Pino](https://github.com/pinojs/pino?tab=readme-ov-file#pino)
* -[ ] [Morgan](https://github.com/expressjs/morgan?tab=readme-ov-file#morgan)
* -[ ] [Log4js](https://github.com/stritti/log4js?tab=readme-ov-file#log4js)
* -[ ] [Bunyan](https://github.com/trentm/node-bunyan)
