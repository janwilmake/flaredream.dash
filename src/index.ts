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
  full_name: string;
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
  const isOwner = currentUser?.login === username;
  const acceptHeader = request.headers.get('Accept') || '';
  
  // Determine format
  const wantsMarkdown = extension === '.md' || 
    (!extension && (acceptHeader.includes('text/markdown') || !acceptHeader.includes('text/html')));
  
  // Determine privacy level and format
  const privacy = isOwner ? 'private' : 'public';
  const format = wantsMarkdown ? 'md' : 'html';
  
  // Try to get pre-generated content from KV
  const cacheKey = `dashboard:${username}:${privacy}:${format}`;
  const cached = await env.FLAREDREAM_KV.get(cacheKey);
  
  if (cached) {
    const contentType = wantsMarkdown ? 'text/markdown;charset=utf8' : 'text/html;charset=utf8';
    return new Response(cached, {
      headers: { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300'
      }
    });
  }

  // No cached content, return placeholder that will trigger refresh
  const placeholderData: DashboardData = {
    cache: 0,
    username,
    repos: [],
    isPrivate: isOwner
  };
  
  const { html, markdown } = generateDashboard(username, currentUser?.login, placeholderData);
  const content = wantsMarkdown ? markdown : html;
  const contentType = wantsMarkdown ? 'text/markdown' : 'text/html';
  
  return new Response(content, {
    headers: { 'Content-Type': contentType }
  });
}

async function handleRefresh(
  request: Request,
  env: Env,
  username: string,
  currentUser: any
): Promise<Response> {
  const isOwner = currentUser?.login === username;
  const accessToken = isOwner ? getAccessToken(request) : undefined;
  
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
    
    const allRepos: GitHubRepo[] = await response.json();
    
    // Generate and store all 4 format combinations
    if (isOwner && accessToken) {
      // Store private versions (with all repos)
      const privateData: DashboardData = {
        cache: Date.now(),
        username,
        repos: allRepos,
        isPrivate: true
      };
      
      const privateFormats = generateDashboard(username, currentUser?.login, privateData);
      
      // Store private HTML
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:private:html`,
        privateFormats.html,
        { expirationTtl: 3600 }
      );
      
      // Store private Markdown
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:private:md`,
        privateFormats.markdown,
        { expirationTtl: 3600 }
      );
      
      // Generate and store public versions (filter out private repos)
      const publicRepos = allRepos.filter(repo => !repo.private);
      const publicData: DashboardData = {
        cache: Date.now(),
        username,
        repos: publicRepos,
        isPrivate: false
      };
      
      const publicFormats = generateDashboard(username, undefined, publicData);
      
      // Store public HTML
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:public:html`,
        publicFormats.html,
        { expirationTtl: 3600 }
      );
      
      // Store public Markdown
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:public:md`,
        publicFormats.markdown,
        { expirationTtl: 3600 }
      );
    } else {
      // Only store public versions
      const publicData: DashboardData = {
        cache: Date.now(),
        username,
        repos: allRepos, // These should already be public only
        isPrivate: false
      };
      
      const publicFormats = generateDashboard(username, undefined, publicData);
      
      // Store public HTML
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:public:html`,
        publicFormats.html,
        { expirationTtl: 3600 }
      );
      
      // Store public Markdown
      await env.FLAREDREAM_KV.put(
        `dashboard:${username}:public:md`,
        publicFormats.markdown,
        { expirationTtl: 3600 }
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
  const isLoggedInAsOwner = loggedUsername === username;
  
  // Generate markdown version
  const markdown = `# ${username}'s Dashboard

${!hasData ? 'Loading repositories...' : `Found ${repos.length} repositories`}

${repos.map(repo => {
  const buttons = [
    `[Context](https://uithub.com/${repo.owner.login}/${repo.name})`,
  ];
  
  return `- ${repo.name} - ${repo.description || 'No description'} - ⭐ ${repo.stargazers_count} | 🍴 ${repo.forks_count} | ${repo.language || 'Unknown'} | Updated: ${new Date(repo.updated_at).toLocaleDateString()}
${buttons.join(' | ')}`;
}).join('\n')}`;

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
            padding: 1rem;
            font-size: 13px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .header h1 {
            font-size: 1.5rem;
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .header-actions {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
        }

        .btn {
            padding: 0.4rem 0.8rem;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 107, 53, 0.3);
            border-radius: 6px;
            color: #ffffff;
            text-decoration: none;
            font-size: 0.8rem;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
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
            transform: translateY(-1px);
            box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
        }

        .search-container {
            margin-bottom: 1rem;
        }

        .search-input {
            width: 100%;
            max-width: 400px;
            padding: 0.6rem 1rem;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 107, 53, 0.3);
            border-radius: 8px;
            color: #ffffff;
            font-size: 0.9rem;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        }

        .search-input:focus {
            outline: none;
            border-color: #ff6b35;
            box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.1);
        }

        .search-input::placeholder {
            color: #666;
        }

        .warning-banner {
            background: rgba(255, 193, 7, 0.1);
            border: 1px solid rgba(255, 193, 7, 0.3);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
            display: ${hasData ? 'none' : 'block'};
        }

        .repos-table {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 12px;
            overflow: hidden;
        }

        .table-header {
            display: grid;
            grid-template-columns: 1fr 2fr 0.8fr 1fr 2fr;
            background: rgba(255, 107, 53, 0.1);
            padding: 0.8rem;
            font-weight: 600;
            border-bottom: 1px solid rgba(255, 107, 53, 0.2);
            color: #ff6b35;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .repo-row {
            display: grid;
            grid-template-columns: 1fr 2fr 0.8fr 1fr 2fr;
            padding: 0.6rem 0.8rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            transition: all 0.2s ease;
            align-items: center;
            min-height: 40px;
        }

        .repo-row:hover {
            background: rgba(255, 107, 53, 0.05);
        }

        .repo-row:last-child {
            border-bottom: none;
        }

        .repo-name {
            font-weight: 600;
            color: #ff6b35;
            font-size: 0.9rem;
        }

        .repo-description {
            color: #ccc;
            font-size: 0.8rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .repo-meta {
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
            font-size: 0.7rem;
            color: #888;
        }

        .repo-stats {
            display: flex;
            gap: 0.8rem;
            font-size: 0.7rem;
            color: #888;
        }

        .repo-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.3rem;
        }

        .repo-btn {
            padding: 0.2rem 0.4rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 4px;
            color: #ffffff;
            text-decoration: none;
            font-size: 0.65rem;
            transition: all 0.2s ease;
            white-space: nowrap;
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

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: #ff6b35;
            animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .hidden {
            display: none !important;
        }

        @media (max-width: 768px) {
            body {
                padding: 0.5rem;
                font-size: 12px;
            }
            
            .header {
                flex-direction: column;
                align-items: flex-start;
            }

            .table-header,
            .repo-row {
                grid-template-columns: 1fr;
                gap: 0.5rem;
            }

            .table-header > div:not(:first-child),
            .repo-row > div:not(:first-child) {
                margin-left: 1rem;
                font-size: 0.7rem;
            }
            
            .repo-actions {
                gap: 0.2rem;
            }
            
            .repo-btn {
                font-size: 0.6rem;
                padding: 0.15rem 0.3rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${username}'s Dashboard</h1>
            <div class="header-actions">
                <a href="https://lmpify.com?q=https://flaredream.com/${username}\n\nI'm looking to build....Please give me a list of uithub urls that can get me started." class="btn btn-primary">🤖 AI Assistant</a>
                <button onclick="refreshDashboard()" class="btn" id="refresh-btn">🔄 Refresh</button>
                ${loggedUsername ? 
                  `<a href="/logout" class="btn">🚪 Logout</a>` : 
                  `<a href="/login?redirect_to=/${username}" class="btn">🔐 Login</a>`
                }
                ${!isLoggedInAsOwner ? `<a href="/" class="btn">🏠 Home</a>` : ''}
            </div>
        </div>

        <div class="search-container">
            <input type="text" class="search-input" placeholder="Search repositories..." id="search-input">
        </div>

        ${!hasData ? `
        <div class="warning-banner">
            <strong>⚠️ Loading repositories...</strong> This may take a moment.
        </div>
        ` : ''}

        <div class="repos-table">
            <div class="table-header">
                <div>Repository</div>
                <div>Description</div>
                <div>Stats</div>
                <div>Meta</div>
                <div>Actions</div>
            </div>
            ${repos.length === 0 ? `
            <div class="loading">
                <p>No repositories found or still loading...</p>
            </div>
            ` : repos.map(repo => `
            <div class="repo-row" data-searchable="${repo.name.toLowerCase()} ${repo.description?.toLowerCase() || ''} ${repo.language?.toLowerCase() || ''}">
                <div class="repo-name">${repo.owner.login === username ? repo.name : repo.full_name}</div>
                <div class="repo-description">${repo.description || 'No description available'}</div>
                <div class="repo-stats">
                    <span>⭐ ${repo.stargazers_count}</span>
                    <span>🍴 ${repo.forks_count}</span>
                </div>
                <div class="repo-meta">
                    <div>${repo.language || 'Unknown'}</div>
                    <div>${new Date(repo.updated_at).toLocaleDateString()}</div>
                </div>
                <div class="repo-actions">
                    <a href="${repo.html_url}" class="repo-btn" target="_blank">GH</a>
                    <a href="https://github.dev/${repo.owner.login}/${repo.name}" class="repo-btn" target="_blank">Dev</a>
                    <a href="https://lmpify.com?q=https://uithub.com/${repo.owner.login}/${repo.name}" class="repo-btn" target="_blank">AI</a>
                    ${repo.homepage ? `<a href="${repo.homepage}" class="repo-btn" target="_blank">Home</a>` : ''}
                    <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers&repository=${repo.html_url}" class="repo-btn" target="_blank">Deploy</a>
                    <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/workers/provider/github/${repo.owner.login}/${repo.name}/configure" class="repo-btn" target="_blank">CI</a>
                    <a href="https://dash.cloudflare.com/?to=/:account/workers/services/view/${repo.name}/production/deployments" class="repo-btn" target="_blank">Logs</a>
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
            const btn = document.getElementById('refresh-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span> Refreshing...';
            btn.disabled = true;

            try {
                const response = await fetch('/${username}/refresh');
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Failed to refresh dashboard');
                }
            } catch (error) {
                alert('Error refreshing dashboard');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                console.log('Copied to clipboard:', text);
            });
        }

        // Search functionality
        document.getElementById('search-input').addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            const rows = document.querySelectorAll('.repo-row[data-searchable]');
            
            rows.forEach(row => {
                const searchData = row.getAttribute('data-searchable');
                if (searchData.includes(searchTerm)) {
                    row.classList.remove('hidden');
                } else {
                    row.classList.add('hidden');
                }
            });
        });

        // Focus search input on key press
        document.addEventListener('keydown', function(e) {
            if (e.key === '/' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                document.getElementById('search-input').focus();
            }
        });
    </script>
</body>
</html>`;

  return { html, markdown };
}
