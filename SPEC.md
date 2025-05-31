# Flaredream - The Better Way To Ship (Dream it, Prompt it, Ship it!)

Redo this in a simpler way making it fully free and the fastest possible.

Learnings that led to this rewrite:

- if I force to restrict my interface I am inclined to create a better one fitting the new set of rules
- **better speed**: we need to load data directly from KV to minimise loadtime to the bare minimum that is required
- **better data**: we now have endpoints for starred repos, recent repos, and lists, public+private
- **better ui**: screenshots aren't all that important, more useful is a tabular view grouping, clear quick actions, and ability to get context easily.

The below definition combines technical simplicity with the best features of previous iterations. The goal is to have a startpage that allows a bird-eye view for Cloudflare.

# DEFINITION

- Auth: use github oauth middleware

- Simple routing
    - `/{username}` shows `dashboard.html` or `dashboard.md` from kv or empty `dashboard.md` or `dashboard.html` if not present.
    - username can be appended with `.html` or `.md` to force formatting, otherwise depends on accept header. check cookie to determine if private or public should be served.
    - `/` shows `homepage.html` or redirects to `/{username}` if logged in
    - `/{username}/refresh` calculates free (and private if logged in) variants of `dashboard.html/md` and sets them to KV.

- Data source: use https://cache.forgithub.com/stars/{username} and https://cache.forgithub.com/stars/owner/private variant

- Separate module: for each repo, check `wrangler.toml/json(c)` to know if it's a worker and to know domain etc. Also parse entrypoint from it and with that, Env details

Frontend `homepage.html`

- Headline: Dream it, Prompt it, Ship it.
- Fill GitHub Username to start, navigates to `/{username}`

Frontend: `generateDashboard(username?:string,loggedUsername?:string,data?:any) => {html,markdown}` template

- Optionally includes data JSON in head with `{cache,username}`
- If data isn't present, it calls `/{username}/refresh` and refreshes the window after its done to retrieve the new HTML
- Button to 'Set to homepage' that can be closed
- On top: lmpify chat plugin that uses system prompt with https://toolflare.com/{username} and instructions to output URLs to use as prompt context
- Refresh button to call `/{username}/refresh`
- If not logged in, login button to verify identity and also get private repos
- Tabular view with repo name and readme-like buttons
- Ability to select multiple and then do something with that
- Ability to group by list
- Add buttons to:
    - repo on github.com
    - link to fav ide (github.dev/bolt.new)
    - link to fav chat (gitmcp, lmpify, etc)
    - copy link to uithub.com
    - if wrangler found:
        - link to open domain
        - fork and deploy
        - deploy
        - configure
        - view deployments
        - link to open each binding in cf dashboard

