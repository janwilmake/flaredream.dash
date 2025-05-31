import { handleOAuth, getCurrentUser, getAccessToken, type Env as OAuthEnv } from './oauth-middleware';
import homepage from './index.html';

interface Env extends OAuthEnv {
  FLAREDREAM_KV: KVNamespace;
}

interface WranglerConfig {
  name?: string;
  routes?: Array<{ pattern: string; custom_domain?: boolean }>;
  route?: { pattern: string; custom_domain?: boolean };
  compatibility_date?: string;
  main?: string;
  [key: string]: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle OAuth routes first
    const oauthResponse = await handleOAuth(request, env, "user:email repo");
    if (oauthResponse) {
      return oauthResponse;
    }

    // Handle routes
    if (url.pathname === '/') {
      return handleHomepage(request, env);
    }

    // Handle refresh endpoint
    const refreshMatch = url.pathname.match(/^\/([^\/]+)\/refresh$/);
    if (refreshMatch) {
      return handleRefresh(refreshMatch[1], request, env);
    }

    // Handle user dashboard
    const userMatch = url.pathname.match(/^\/([^\/]+)(?:\.(html|md))?$/);
    if (userMatch) {
      const username = userMatch[1];
      const format = userMatch[2] || getPreferredFormat(request);
      return handleUserDashboard(username, format, request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleHomepage(request: Request, env: Env): Promise<Response> {
  const user = getCurrentUser(request);
  
  // If logged in, redirect to user dashboard
  if (user) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/${user.login}` }
    });
  }

  return new Response(homepage, {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function handleUserDashboard(username: string, format: string, request: Request, env: Env): Promise<Response> {
  const user = getCurrentUser(request);
  const isPrivate = user?.login === username;
  
  // Try to get cached dashboard
  const cacheKey = `dashboard:${username}:${isPrivate ? 'private' : 'public'}:${format}`;
  const cached = await env.FLAREDREAM_KV.get(cacheKey);
  
  if (cached) {
    const contentType = format === 'md' ? 'text/markdown' : 'text/html';
    return new Response(cached, {
      headers: { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  // If not cached, generate dashboard
  return generateAndCacheDashboard(username, format, isPrivate, request, env);
}

async function handleRefresh(username: string, request: Request, env: Env): Promise<Response> {
  const user = getCurrentUser(request);
  const isPrivate = user?.login === username;
  
  // Generate both HTML and Markdown versions
  await Promise.all([
    generateAndCacheDashboard(username, 'html', isPrivate, request, env),
    generateAndCacheDashboard(username, 'md', isPrivate, request, env)
  ]);

  return new Response('Dashboard refreshed', {
    headers: { 'Content-Type': 'text/plain' }
  });
}

async function generateAndCacheDashboard(username: string, format: string, isPrivate: boolean, request: Request, env: Env): Promise<Response> {
  try {
    // Fetch data from cache.forgithub.com
    const accessToken = getAccessToken(request);
    const endpoint = isPrivate ? `/stars/${username}/private` : `/stars/${username}`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'Flaredream/1.0'
    };
    
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`https://cache.forgithub.com${endpoint}`, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status}`);
    }

    const data = await response.json() as any;
    
    // Generate dashboard content
    const content = format === 'md' 
      ? generateMarkdownDashboard(username, data, isPrivate)
      : generateHTMLDashboard(username, data, isPrivate);

    // Cache the result
    const cacheKey = `dashboard:${username}:${isPrivate ? 'private' : 'public'}:${format}`;
    await env.FLAREDREAM_KV.put(cacheKey, content, { expirationTtl: 3600 });

    const contentType = format === 'md' ? 'text/markdown' : 'text/html';
    return new Response(content, {
      headers: { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error generating dashboard:', error);
    
    const errorContent = format === 'md' 
      ? `# Error\n\nCould not generate dashboard for ${username}`
      : `<h1>Error</h1><p>Could not generate dashboard for ${username}</p>`;
    
    const contentType = format === 'md' ? 'text/markdown' : 'text/html';
    return new Response(errorContent, {
      status: 500,
      headers: { 'Content-Type': contentType }
    });
  }
}

function generateHTMLDashboard(username: string, data: any, isPrivate: boolean): string {
  const { stars = [], lists = [] } = data;
  
  // Process repositories to detect workers
  const processedRepos = stars.map((repo: any) => ({
    ...repo,
    isWorker: false, // We'll enhance this later
    workerInfo: null
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${username}'s Dashboard - Flaredream</title>
    <script type="application/json" id="dashboard-data">
    ${JSON.stringify({ cache: true, username, data })}
    </script>
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
            overflow-x: hidden;
        }

        .header {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid rgba(255, 107, 53, 0.2);
            padding: 1.5rem 2rem;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .brand h1 {
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .user-info {
            font-size: 1.1rem;
            color: #ccc;
        }

        .actions {
            display: flex;
            gap: 1rem;
            align-items: center;
            flex-wrap: wrap;
        }

        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
        }

        .btn-primary {
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            color: white;
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: 1px solid rgba(255, 107, 53, 0.3);
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
        }

        .main-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .stat-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
        }

        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #ff6b35;
            margin-bottom: 0.5rem;
        }

        .stat-label {
            color: #ccc;
            font-size: 0.9rem;
        }

        .repos-section {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 12px;
            overflow: hidden;
        }

        .section-header {
            padding: 1.5rem 2rem;
            border-bottom: 1px solid rgba(255, 107, 53, 0.2);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .section-title {
            font-size: 1.25rem;
            font-weight: 600;
        }

        .repo-grid {
            display: grid;
            gap: 1px;
            background: rgba(255, 107, 53, 0.1);
        }

        .repo-row {
            background: rgba(0, 0, 0, 0.3);
            padding: 1.5rem 2rem;
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: 1rem;
            transition: background 0.3s ease;
        }

        .repo-row:hover {
            background: rgba(255, 107, 53, 0.05);
        }

        .repo-info {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .repo-name {
            font-size: 1.1rem;
            font-weight: 600;
            color: #fff;
        }

        .repo-description {
            color: #ccc;
            font-size: 0.9rem;
            line-height: 1.4;
        }

        .repo-meta {
            display: flex;
            gap: 1rem;
            margin-top: 0.5rem;
            flex-wrap: wrap;
        }

        .meta-item {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            font-size: 0.8rem;
            color: #999;
        }

        .repo-actions {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
        }

        .btn-small {
            padding: 0.5rem 1rem;
            font-size: 0.8rem;
            border-radius: 6px;
        }

        .worker-badge {
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        @media (max-width: 768px) {
            .header-content {
                flex-direction: column;
                text-align: center;
            }

            .main-content {
                padding: 1rem;
            }

            .repo-row {
                grid-template-columns: 1fr;
                gap: 1rem;
            }

            .repo-actions {
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="header-content">
            <div class="brand">
                <h1>Flaredream</h1>
                <div class="user-info">${username}'s Dashboard</div>
            </div>
            <div class="actions">
                <a href="/${username}/refresh" class="btn btn-secondary">
                    🔄 Refresh
                </a>
                ${!isPrivate ? `<a href="/login?redirect_to=/${username}" class="btn btn-primary">🔐 Login for Private Repos</a>` : ''}
                ${isPrivate ? `<a href="/logout" class="btn btn-secondary">🚪 Logout</a>` : ''}
                <a href="/" class="btn btn-secondary">🏠 Home</a>
            </div>
        </div>
    </header>

    <main class="main-content">
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">${stars.length}</div>
                <div class="stat-label">Starred Repos</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${lists.length}</div>
                <div class="stat-label">Lists</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stars.filter((r: any) => r.language === 'TypeScript').length}</div>
                <div class="stat-label">TypeScript Repos</div>
            </div>
        </div>

        <div class="repos-section">
            <div class="section-header">
                <h2 class="section-title">Starred Repositories</h2>
                <div class="meta-item">
                    ${isPrivate ? '🔒 Private + Public' : '🌍 Public Only'}
                </div>
            </div>
            <div class="repo-grid">
                ${stars.map((repo: any) => `
                    <div class="repo-row">
                        <div class="repo-info">
                            <div class="repo-name">
                                ${repo.owner.login}/${repo.name}
                                ${repo.private ? '🔒' : ''}
                            </div>
                            ${repo.description ? `<div class="repo-description">${repo.description}</div>` : ''}
                            <div class="repo-meta">
                                ${repo.language ? `<div class="meta-item">📝 ${repo.language}</div>` : ''}
                                <div class="meta-item">⭐ ${repo.stargazers_count}</div>
                                <div class="meta-item">🍴 ${repo.forks_count}</div>
                                ${repo.topics && repo.topics.length > 0 ? `<div class="meta-item">🏷️ ${repo.topics.slice(0, 3).join(', ')}</div>` : ''}
                            </div>
                        </div>
                        <div class="repo-actions">
                            <a href="${repo.html_url}" target="_blank" class="btn btn-small btn-secondary">
                                📖 GitHub
                            </a>
                            <a href="https://github.dev/${repo.owner.login}/${repo.name}" target="_blank" class="btn btn-small btn-secondary">
                                ⚡ GitHub.dev
                            </a>
                            <a href="https://uithub.com/${repo.owner.login}/${repo.name}" target="_blank" class="btn btn-small btn-secondary">
                                🔍 UIthub
                            </a>
                            ${repo.homepage ? `<a href="${repo.homepage}" target="_blank" class="btn btn-small btn-primary">🌐 Live</a>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        ${lists.length > 0 ? `
            <div class="repos-section" style="margin-top: 2rem;">
                <div class="section-header">
                    <h2 class="section-title">GitHub Lists</h2>
                </div>
                <div class="repo-grid">
                    ${lists.map((list: any) => `
                        <div class="repo-row">
                            <div class="repo-info">
                                <div class="repo-name">
                                    ${list.name}
                                    ${list.isPrivate ? '🔒' : '🌍'}
                                </div>
                                ${list.description ? `<div class="repo-description">${list.description}</div>` : ''}
                                <div class="repo-meta">
                                    <div class="meta-item">📚 ${list.totalRepositories} repositories</div>
                                    <div class="meta-item">📅 Updated ${new Date(list.updatedAt).toLocaleDateString()}</div>
                                </div>
                            </div>
                            <div class="repo-actions">
                                <a href="https://github.com/stars/${username}/lists/${list.slug}" target="_blank" class="btn btn-small btn-secondary">
                                    📋 View List
                                </a>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    </main>

    <script>
        // Add any interactive functionality here
        console.log('Flaredream Dashboard loaded for ${username}');
        
        // Auto-refresh functionality
        const refreshBtn = document.querySelector('a[href$="/refresh"]');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                refreshBtn.textContent = '🔄 Refreshing...';
                
                try {
                    const response = await fetch('/${username}/refresh');
                    if (response.ok) {
                        location.reload();
                    } else {
                        throw new Error('Refresh failed');
                    }
                } catch (error) {
                    refreshBtn.textContent = '❌ Refresh Failed';
                    setTimeout(() => {
                        refreshBtn.textContent = '🔄 Refresh';
                    }, 2000);
                }
            });
        }
    </script>
</body>
</html>`;
}

function generateMarkdownDashboard(username: string, data: any, isPrivate: boolean): string {
  const { stars = [], lists = [] } = data;
  
  return `# ${username}'s Dashboard

${isPrivate ? '🔒 **Private + Public Repositories**' : '🌍 **Public Repositories Only**'}

## Stats

- **Starred Repos**: ${stars.length}
- **Lists**: ${lists.length}
- **TypeScript Repos**: ${stars.filter((r: any) => r.language === 'TypeScript').length}

## Starred Repositories

${stars.map((repo: any) => `
### ${repo.owner.login}/${repo.name} ${repo.private ? '🔒' : ''}

${repo.description || '_No description provided_'}

**Details:**
- Language: ${repo.language || 'Not specified'}
- Stars: ⭐ ${repo.stargazers_count}
- Forks: 🍴 ${repo.forks_count}
${repo.topics && repo.topics.length > 0 ? `- Topics: ${repo.topics.join(', ')}` : ''}

**Links:**
- [GitHub](${repo.html_url})
- [GitHub.dev](https://github.dev/${repo.owner.login}/${repo.name})
- [UIthub](https://uithub.com/${repo.owner.login}/${repo.name})
${repo.homepage ? `- [Live Site](${repo.homepage})` : ''}

---
`).join('')}

${lists.length > 0 ? `
## GitHub Lists

${lists.map((list: any) => `
### ${list.name} ${list.isPrivate ? '🔒' : '🌍'}

${list.description || '_No description provided_'}

- **Repositories**: ${list.totalRepositories}
- **Updated**: ${new Date(list.updatedAt).toLocaleDateString()}
- [View List](https://github.com/stars/${username}/lists/${list.slug})

---
`).join('')}
` : ''}

---

*Generated by [Flaredream](/) - Dream It, Prompt It, Ship It!*
`;
}

function getPreferredFormat(request: Request): string {
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('text/markdown') || accept.includes('text/plain')) {
    return 'md';
  }
  return 'html';
}

async function detectWorkerConfig(owner: string, repo: string, accessToken?: string): Promise<WranglerConfig | null> {
  const files = ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'];
  
  for (const file of files) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Flaredream/1.0'
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file}`, { headers });
      
      if (response.ok) {
        const data = await response.json() as any;
        const content = atob(data.content);
        
        if (file.endsWith('.toml')) {
          // Simple TOML parsing for basic values
          return parseSimpleToml(content);
        } else {
          return JSON.parse(content);
        }
      }
    } catch (error) {
      // Continue to next file
    }
  }
  
  return null;
}

function parseSimpleToml(content: string): WranglerConfig {
  const config: WranglerConfig = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^(\w+)\s*=\s*"([^"]+)"/);
      if (match) {
        const [, key, value] = match;
        config[key] = value;
      }
    }
  }
  
  return config;
}