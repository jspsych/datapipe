## Goal

The goal here is to provide a minimal hosting service for jsPsych experiments so that researchers
can deploy an experiment on a static hosting provider, like GitHub Pages, and use this service
as a bridge to data storage on the OSF. Hopefully this bridge will be cheap enough that it can
be a free or donation based service.

## Design

We'll expose a minimal API that allows the transfer of one file of data. The jsPsych experiment
can make a `fetch` call to this service with the data.

We'll rely on users to provide authentication credentials to OSF. When we get a request, we can
validate the incoming data and then use the OSF API to create a file. We will provide a small UI
to let people start and stop projects, and configure various options.

## Securing the service

Ideas about securing this:

- Rate Limit requests.
- Run validation on the data.
- Setup project-specific URLs so we can access control.