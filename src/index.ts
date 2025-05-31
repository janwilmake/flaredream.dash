import { handleOAuth, getCurrentUser, getAccessToken, type Env as OAuthEnv } from './oauth-middleware';
import homepage from '../index.html';

interface Env extends OAuthEnv {
  FLAREDREAM_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  owner: { login: string; id: number };
  description: string;
  html_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  topics: string[];
  archived: boolean;
  private: boolean;
  homepage: string;
  stargazers_count: number;
  watchers_count: number;
  forks: number;
  open_issues: number;
  size: number;
  language: string | null;
  forks_count: number;
}

interface DashboardData {
  cache: number;
  username: string;
  repos: GitHubRepo[];
  isPrivate: boolean;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle OAuth routes first
    const oauthResponse = await handleOAuth(request, env, "repo");
    if (oauthResponse) {
      return oauthResponse;
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const currentUser = getCurrentUser(request);
    
    // Root path - show homepage or redirect to user dashboard
    if (path === '/') {
      if (currentUser) {
        return new Response(null, {
          status: 302,
          headers: { Location: `/${currentUser.login}` }
        });
      }
      return new Response(homepage, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Parse username route
    const match = path.match(/^\/([^\/]+)(\.html|\.md)?$/);
    if (match) {
      const [, username, extension] = match;
      return handleDashboard(request, env, username, extension, currentUser);
    }

    // Refresh route
    const refreshMatch = path.match(/^\/([^\/]+)\/refresh$/);
    if (refreshMatch) {
      const [, username] = refreshMatch;
      return handleRefresh(request, env, username, currentUser);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleDashboard(
  request: Request, 
  env: Env, 
  username: string, 
  extension: string | undefined,
  currentUser: any
): Promise<Response> {
  const isPrivate = currentUser?.login === username;
  const cacheKey = `dashboard:${username}:${isPrivate ? 'private' : 'public'}`;
  
  // Try to get cached version
  const cached = await env.FLAREDREAM_KV.get(cacheKey);
  if (cached) {
    const data: DashboardData = JSON.parse(cached);
    const { html, markdown } = generateDashboard(username, currentUser?.login, data);
    
    const acceptHeader = request.headers.get('Accept') || '';
    const wantsMarkdown = extension === '.md' || 
      (!extension && acceptHeader.includes('text/markdown'));
    
    return new Response(wantsMarkdown ? markdown : html, {
      headers: { 
        'Content-Type': wantsMarkdown ? 'text/markdown' : 'text/html',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }

  // No cached data, return placeholder that will trigger refresh
  const placeholderData: DashboardData = {
    cache: 0,
    username,
    repos: [],
    isPrivate
  };
  
  const { html, markdown } = generateDashboard(username, currentUser?.login, placeholderData);
  
  const acceptHeader = request.headers.get('Accept') || '';
  const wantsMarkdown = extension === '.md' || 
    (!extension && acceptHeader.includes('text/markdown'));
  
  return new Response(wantsMarkdown ? markdown : html, {
    headers: { 
      'Content-Type': wantsMarkdown ? 'text/markdown' : 'text/html'
    }
  });
}

async function handleRefresh(
  request: Request,
  env: Env,
  username: string,
  currentUser: any
): Promise<Response> {
  const isPrivate = currentUser?.login === username;
  const accessToken = isPrivate ? getAccessToken(request) : undefined;
  
  try {
    // Fetch data from cache.forgithub.com
    const apiUrl = new URL(`https://cache.forgithub.com/repos/${username}`);
    if (accessToken) {
      apiUrl.searchParams.set('apiKey', accessToken);
    }
    
    const response = await fetch(apiUrl.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch repos: ${response.status}`);
    }
    
    const repos: GitHubRepo[] = await response.json();
    
    // Store both public and private versions if we have private access
    if (isPrivate) {
      // Store private version
      const privateData: DashboardData = {
        cache: Date.now(),
        username,
        repos,
        isPrivate: true
      };
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:private`,
        JSON.stringify(privateData),
        { expirationTtl: 3600 } // 1 hour
      );
      
      // Store public version (filter out private repos)
      const publicRepos = repos.filter(repo => !repo.private);
      const publicData: DashboardData = {
        cache: Date.now(),
        username,
        repos: publicRepos,
        isPrivate: false
      };
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:public`,
        JSON.stringify(publicData),
        { expirationTtl: 3600 } // 1 hour
      );
    } else {
      // Store public version only
      const publicData: DashboardData = {
        cache: Date.now(),
        username,
        repos,
        isPrivate: false
      };
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:public`,
        JSON.stringify(publicData),
        { expirationTtl: 3600 } // 1 hour
      );
    }
    
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Refresh error:', error);
    return new Response('Failed to refresh data', { status: 500 });
  }
}

function generateDashboard(username?: string, loggedUsername?: string, data?: DashboardData): { html: string; markdown: string } {
  const repos = data?.repos || [];
  const hasData = data && data.cache > 0;
  
  // Generate markdown version
  const markdown = `# ${username}'s Dashboard

${!hasData ? 'Loading repositories...' : `Found ${repos.length} repositories`}

${repos.map(repo => {
  const buttons = [
    `[GitHub](${repo.html_url})`,
    `[GitHub.dev](https://github.dev/${repo.owner.login}/${repo.name})`,
    `[Bolt.new](https://bolt.new/github/${repo.owner.login}/${repo.name})`,
    `[Lmpify](https://lmpify.com?q=https://uithub.com/${repo.owner.login}/${repo.name})`,
    `[Copy uithub](https://uithub.com/${repo.owner.login}/${repo.name})`,
    `[Deploy Template](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers&repository=${repo.html_url})`,
    `[Setup CI](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/workers/provider/github/${repo.owner.login}/${repo.name}/configure)`,
    `[Manage Worker](https://dash.cloudflare.com/?to=/:account/workers-and-pages/workers/services/view/${repo.name}/production/settings)`,
    `[View Deployments](https://dash.cloudflare.com/?to=/:account/workers/services/view/${repo.name}/production/deployments)`
  ];
  
  return `## ${repo.name}
${repo.description || 'No description'}

⭐ ${repo.stargazers_count} | 🍴 ${repo.forks_count} | ${repo.language || 'Unknown'} | Updated: ${new Date(repo.updated_at).toLocaleDateString()}

${buttons.join(' | ')}`;
}).join('\n\n')}`;

  // Generate HTML version
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${username}'s Dashboard - Flaredream</title>
    ${hasData ? `<script type="application/json" id="dashboard-data">
    ${JSON.stringify({ cache: data.cache, username: data.username })}
    </script>` : ''}
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a1810 100%);
            min-height: 100vh;
            color: #ffffff;
            padding: 2rem;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .header h1 {
            font-size: 2rem;
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .header-actions {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
        }

        .btn {
            padding: 0.5rem 1rem;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 107, 53, 0.3);
            border-radius: 8px;
            color: #ffffff;
            text-decoration: none;
            font-size: 0.9rem;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        }

        .btn:hover {
            background: rgba(255, 107, 53, 0.2);
            border-color: #ff6b35;
        }

        .btn-primary {
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            border: none;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
        }

        .warning-banner {
            background: rgba(255, 193, 7, 0.1);
            border: 1px solid rgba(255, 193, 7, 0.3);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 2rem;
            display: ${hasData ? 'none' : 'block'};
        }

        .repo-grid {
            display: grid;
            gap: 1.5rem;
        }

        .repo-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 16px;
            padding: 1.5rem;
            transition: all 0.3s ease;
        }

        .repo-card:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 107, 53, 0.4);
            transform: translateY(-2px);
        }

        .repo-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1rem;
        }

        .repo-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #ff6b35;
            margin-bottom: 0.5rem;
        }

        .repo-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.85rem;
            color: #888;
            margin-bottom: 1rem;
        }

        .repo-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .repo-btn {
            padding: 0.25rem 0.75rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 6px;
            color: #ffffff;
            text-decoration: none;
            font-size: 0.8rem;
            transition: all 0.2s ease;
        }

        .repo-btn:hover {
            background: rgba(255, 107, 53, 0.1);
            border-color: #ff6b35;
        }

        .loading {
            text-align: center;
            padding: 3rem;
            color: #888;
        }

        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }
            
            .header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .repo-actions {
                gap: 0.25rem;
            }
            
            .repo-btn {
                font-size: 0.75rem;
                padding: 0.2rem 0.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${username}'s Dashboard</h1>
            <div class="header-actions">
                <a href="https://lmpify.com?q=https://flaredream.com/${username} + instructions to output URLs to use as prompt context" class="btn btn-primary">🤖 AI Assistant</a>
                <button onclick="refreshDashboard()" class="btn">🔄 Refresh</button>
                ${loggedUsername ? 
                  `<a href="/logout" class="btn">🚪 Logout</a>` : 
                  `<a href="/login?redirect_to=/${username}" class="btn">🔐 Login</a>`
                }
                <a href="/" class="btn">🏠 Home</a>
            </div>
        </div>

        ${!hasData ? `
        <div class="warning-banner">
            <strong>⚠️ Loading repositories...</strong> This may take a moment.
        </div>
        ` : ''}

        <div class="repo-grid">
            ${repos.length === 0 ? `
            <div class="loading">
                <p>No repositories found or still loading...</p>
            </div>
            ` : repos.map(repo => `
            <div class="repo-card">
                <div class="repo-header">
                    <div>
                        <div class="repo-title">${repo.name}</div>
                        <p>${repo.description || 'No description available'}</p>
                    </div>
                </div>
                <div class="repo-meta">
                    <span>⭐ ${repo.stargazers_count}</span>
                    <span>🍴 ${repo.forks_count}</span>
                    <span>${repo.language || 'Unknown'}</span>
                    <span>Updated: ${new Date(repo.updated_at).toLocaleDateString()}</span>
                </div>
                <div class="repo-actions">
                    <a href="${repo.html_url}" class="repo-btn" target="_blank">GitHub</a>
                    <a href="https://github.dev/${repo.owner.login}/${repo.name}" class="repo-btn" target="_blank">GitHub.dev</a>
                    <a href="https://bolt.new/github/${repo.owner.login}/${repo.name}" class="repo-btn" target="_blank">Bolt.new</a>
                    <a href="https://lmpify.com?q=https://uithub.com/${repo.owner.login}/${repo.name}" class="repo-btn" target="_blank">Lmpify</a>
                    <button onclick="copyToClipboard('https://uithub.com/${repo.owner.login}/${repo.name}')" class="repo-btn">Copy uithub</button>
                    ${repo.homepage ? `<a href="${repo.homepage}" class="repo-btn" target="_blank">Homepage</a>` : ''}
                    <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers&repository=${repo.html_url}" class="repo-btn" target="_blank">Deploy Template</a>
                    <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/workers/provider/github/${repo.owner.login}/${repo.name}/configure" class="repo-btn" target="_blank">Setup CI</a>
                    <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/workers/services/view/${repo.name}/production/settings" class="repo-btn" target="_blank">Manage Worker</a>
                    <a href="https://dash.cloudflare.com/?to=/:account/workers/services/view/${repo.name}/production/deployments" class="repo-btn" target="_blank">View Deployments</a>
                </div>
            </div>
            `).join('')}
        </div>
    </div>

    <script>
        ${!hasData ? `
        // Auto-refresh if no data
        setTimeout(() => {
            refreshDashboard();
        }, 1000);
        ` : ''}

        async function refreshDashboard() {
            try {
                const response = await fetch('/${username}/refresh');
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Failed to refresh dashboard');
                }
            } catch (error) {
                alert('Error refreshing dashboard');
            }
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                // Could show a toast notification here
                console.log('Copied to clipboard:', text);
            });
        }
    </script>
</body>
</html>`;

  return { html, markdown };
}