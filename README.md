# Flaredream - Dream It, Prompt It, Ship It!

A beautiful, fast dashboard for your GitHub repositories with seamless Cloudflare Workers deployment integration.

## Features

- 🚀 **Lightning Fast**: Direct KV storage for minimal load times
- 🔐 **GitHub OAuth**: Secure authentication for private repositories
- ⚡ **Worker Detection**: Automatic detection of Cloudflare Workers projects
- 🎯 **One-Click Deploy**: Direct integration with Cloudflare deployment flows
- 📱 **Responsive Design**: Beautiful glassmorphism UI that works everywhere
- 🤖 **AI Integration**: Built-in chat plugin for repository assistance

## Setup

1. **Create a GitHub OAuth App**:
   - Go to https://github.com/settings/developers
   - Create a new OAuth App
   - Set callback URL to `https://your-domain.com/callback`

2. **Configure Wrangler**:
   ```bash
   # Set your GitHub OAuth credentials
   wrangler secret put GITHUB_CLIENT_SECRET
   
   # Create KV namespace
   wrangler kv:namespace create "FLAREDREAM_KV"
   ```

3. **Update wrangler.json**:
   - Replace `your-kv-namespace-id` with your actual KV namespace ID
   - Replace `your-github-client-id` with your GitHub OAuth client ID
   - Update domain routes as needed

4. **Deploy**:
   ```bash
   wrangler deploy
   ```

## How It Works

### Routes

- `/` - Homepage (redirects to user dashboard if logged in)
- `/{username}` - User dashboard (public repos, private if authenticated)
- `/{username}.html` - Force HTML format
- `/{username}.md` - Force Markdown format  
- `/{username}/refresh` - Regenerate and cache dashboard
- `/login` - GitHub OAuth login
- `/logout` - Logout and clear session
- `/callback` - OAuth callback handler

### Data Sources

- **Public repos**: `https://cache.forgithub.com/stars/{username}`
- **Private repos**: `https://cache.forgithub.com/stars/owner/private` (when authenticated)
- **Worker detection**: Automatically parses `wrangler.toml/json/jsonc` files

### Features

#### Worker Integration
When a repository contains a `wrangler.toml`, `wrangler.json`, or `wrangler.jsonc` file, Flaredream automatically:
- Detects it as a Cloudflare Worker project
- Extracts domain/route information
- Provides quick deploy and management links

#### Deep Cloudflare Integration
Uses Cloudflare's deeplink system to provide direct access to:
- Deploy to Workers: One-click deployment from GitHub
- Configure CI/CD: Set up automatic deployments
- View deployments: Monitor deployment history
- Manage settings: Direct links to worker configuration

#### Smart Caching
- Dashboard content is cached in KV for lightning-fast loads
- Separate caches for public and private views
- Refresh endpoint regenerates cache on demand

## Usage

1. **Visit the homepage** and enter any GitHub username
2. **Login** to see private repositories and get enhanced features
3. **Refresh** dashboard to update repository data
4. **Deploy** workers with one-click Cloudflare integration

## Development

```bash
# Install dependencies
npm install

# Start development server
wrangler dev

# Deploy to production
wrangler deploy
```

## License

MIT License - feel free to use this project for your own needs!