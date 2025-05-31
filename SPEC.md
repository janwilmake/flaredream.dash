# Flaredream - The Better Way To Ship (Dream it, Prompt it, Ship it!)

Redo this in a simpler way making it fully free and the fastest possible.

Learnings that led to this rewrite:

- if I force to restrict my interface I am inclined to create a better one fitting the new set of rules
- **better speed**: we need to load data directly from KV to minimise loadtime to the bare minimum that is required
- **better data**: we now have endpoints for starred repos, recent repos, and lists, public+private
- **better ui**: screenshots aren't all that important, more useful is a tabular view grouping, clear quick actions, and ability to get context easily.

The below definition combines technical simplicity with the best features of previous iterations. The goal is to have a startpage that allows a bird-eye view for Cloudflare.

# DEFINITION

Context

https://uithub.com/janwilmake/github-oauth-middleware
https://uithub.com/janwilmake/gists/blob/main/named-codeblocks.md
https://oapis.org/openapi/cache.forgithub.com/getOwnerRepositories

- put all source in the root, no src folder needed
- you can import the homepage using import homepage from "./index.html" as it's already there
- Auth: use github oauth middleware

- Simple routing
    - `/{username}` shows `dashboard.html` or `dashboard.md` from kv or empty `dashboard.md` or `dashboard.html` if not present.
    - username can be appended with `.html` or `.md` to force formatting, otherwise depends on accept header. check cookie to determine if private or public should be served.
    - `/` shows `homepage.html` or redirects to `/{username}` if logged in
    - `/{username}/refresh` calculates free (and private if logged in) variants of `dashboard.html/md` and sets them to KV.

- Data source: use https://cache.forgithub.com/repos/{owner} (with or without apikey)
- If api key is given, returns all repos including private. private repos must be filtered out for the public kv storage

Frontend `homepage.html`

- Headline: Dream it, Prompt it, Ship it.
- Fill GitHub Username to start, navigates to `/{username}`

Frontend: `generateDashboard(username?:string,loggedUsername?:string,data?:any) => {html,markdown}` template

- Optionally includes data JSON in head with `{cache,username}`
- If data isn't present, it calls `/{username}/refresh` and refreshes the window after its done to retrieve the new HTML
- Button to 'Set to homepage' that can be closed
- On top: link to lmpify: https://lmpify.com?q={prompt} with prompt 'https://flaredream.com/{username} + instructions to output URLs to use as prompt context'
- Refresh button to call `/{username}/refresh`
- If not logged in, login button to verify identity and also get private repos
- Tabular view with repo name and readme-like buttons
- Add buttons to:
    - repo on github.com
    - link to fav ide (github.dev/bolt.new)
    - link to fav chat (gitmcp, lmpify, etc)
    - copy link to uithub.com
    - link to homepage
    - fork and deploy
    - Create new git repo from template: https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers&repository=https://github.com/{owner}/{repo}
    - Link existing repo to automatic Cloudflare deployment CI: https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/workers/provider/github/{owner}/{repo}/configure
    - Manage the worker configuration: https://dash.cloudflare.com/?to=/:account/workers-and-pages/workers/services/view/{repo}/production/settings
    - View deployments: https://dash.cloudflare.com/?to=/:account/workers/services/view/{repo}/production/deployments



# Iterations


1 - https://lmpify.com/httpsuithubcomj-zcgo9l0 

Improvements needed: add openapi context of cache, small details

2 - https://lmpify.com/httpsuithubcomj-6xrqqk0

Improvements needed: the wrangler buttons weren't there and wrangler parse was too hard. also i wanted a better tablelike layout

3 - https://lmpify.com/httpsuithubcomj-soetz80

After this several more improvements were made manually.