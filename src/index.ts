// Import the GitHub OAuth middleware
import { handleOAuth, getCurrentUser, getAccessToken, type Env as OAuthEnv } from './oauth-middleware';
import homepage from '../index.html';

interface Env extends OAuthEnv {
  FLAREDREAM_KV: KVNamespace;
}

interface WranglerConfig {
  name?: string;
  routes?: Array<{ pattern: string; custom_domain?: boolean }>;
  route?: { pattern: string; custom_domain?: boolean };
  compatibility_date?: string;
  main?: string;
  vars?: Record<string, any>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  d1_databases?: Array<{ binding: string; database_name: string; database_id: string }>;
}

interface Repository {
  id: number;
  name: string;
  owner: { login: string; id: number };
  description: string | null;
  html_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  topics: string[];
  archived: boolean;
  private: boolean;
  homepage: string | null;
  stargazers_count: number;
  watchers_count: number;
  forks: number;
  open_issues: number;
  size: number;
  language: string | null;
  forks_count: number;
}

interface RepositoryWithWorker extends Repository {
  isWorker?: boolean;
  wranglerConfig?: WranglerConfig;
  domains?: string[];
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

    // Parse username and format from path
    const pathMatch = path.match(/^\/([^\/]+)(\.html|\.md)?$/);
    if (pathMatch) {
      const username = pathMatch[1];
      const format = pathMatch[2]?.slice(1); // Remove the dot
      return handleUserDashboard(request, env, username, format);
    }

    // Handle refresh route
    const refreshMatch = path.match(/^\/([^\/]+)\/refresh$/);
    if (refreshMatch) {
      const username = refreshMatch[1];
      return handleRefresh(request, env, username);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleUserDashboard(request: Request, env: Env, username: string, format?: string): Promise<Response> {
  const currentUser = getCurrentUser(request);
  const isOwner = currentUser?.login === username;
  
  // Determine format based on explicit format, Accept header, or default to HTML
  let responseFormat = format;
  if (!responseFormat) {
    const acceptHeader = request.headers.get('Accept') || '';
    responseFormat = acceptHeader.includes('text/markdown') ? 'md' : 'html';
  }

  // Generate cache key
  const cacheKey = `dashboard:${username}:${isOwner ? 'private' : 'public'}:${responseFormat}`;
  
  // Try to get cached content
  let content = await env.FLAREDREAM_KV.get(cacheKey);
  
  if (!content) {
    // Generate fresh content and redirect to refresh
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Loading ${username}'s Dashboard</title>
        <meta http-equiv="refresh" content="0; url=/${username}/refresh">
      </head>
      <body>
        <p>Generating dashboard... <a href="/${username}/refresh">Click here if not redirected</a></p>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  const contentType = responseFormat === 'md' ? 'text/markdown' : 'text/html';
  return new Response(content, {
    headers: { 'Content-Type': contentType }
  });
}

async function handleRefresh(request: Request, env: Env, username: string): Promise<Response> {
  const currentUser = getCurrentUser(request);
  const accessToken = getAccessToken(request);
  const isOwner = currentUser?.login === username;

  try {
    // Fetch repositories data
    const apiUrl = `https://cache.forgithub.com/repos/${username}`;
    const headers: Record<string, string> = {};
    
    if (isOwner && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(apiUrl, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch repositories: ${response.status}`);
    }

    const repositories: Repository[] = await response.json();
    
    // Process repositories to detect workers
    const processedRepos = await Promise.all(
      repositories.map(repo => processRepository(repo, accessToken))
    );

    // Generate both HTML and Markdown versions
    const data = { username, repositories: processedRepos, isOwner, currentUser };
    const html = generateDashboard(data, 'html');
    const markdown = generateDashboard(data, 'md');

    // Cache both versions
    const publicCacheKey = `dashboard:${username}:public`;
    const privateCacheKey = `dashboard:${username}:private`;
    
    await Promise.all([
      env.FLAREDREAM_KV.put(`${publicCacheKey}:html`, html),
      env.FLAREDREAM_KV.put(`${publicCacheKey}:md`, markdown),
    ]);

    if (isOwner) {
      await Promise.all([
        env.FLAREDREAM_KV.put(`${privateCacheKey}:html`, html),
        env.FLAREDREAM_KV.put(`${privateCacheKey}:md`, markdown),
      ]);
    }

    // Redirect back to dashboard
    return new Response(null, {
      status: 302,
      headers: { Location: `/${username}` }
    });

  } catch (error) {
    return new Response(`Error refreshing dashboard: ${error}`, { status: 500 });
  }
}

async function processRepository(repo: Repository, accessToken?: string | null): Promise<RepositoryWithWorker> {
  const processedRepo: RepositoryWithWorker = { ...repo };
  
  // Check for wrangler configuration files
  const wranglerFiles = ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'];
  
  for (const fileName of wranglerFiles) {
    try {
      const fileUrl = `https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/${fileName}`;
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Flaredream'
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(fileUrl, { headers });
      
      if (response.ok) {
        const fileData = await response.json() as any;
        const content = atob(fileData.content);
        
        processedRepo.isWorker = true;
        processedRepo.wranglerConfig = parseWranglerConfig(content, fileName);
        processedRepo.domains = extractDomains(processedRepo.wranglerConfig);
        break;
      }
    } catch (error) {
      // Continue to next file
    }
  }

  return processedRepo;
}

function parseWranglerConfig(content: string, fileName: string): WranglerConfig {
  try {
    if (fileName.endsWith('.toml')) {
      // Simple TOML parsing for basic fields
      const config: WranglerConfig = {};
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('name =')) {
          config.name = trimmed.split('=')[1].trim().replace(/['"]/g, '');
        }
        if (trimmed.startsWith('main =')) {
          config.main = trimmed.split('=')[1].trim().replace(/['"]/g, '');
        }
        if (trimmed.includes('pattern =')) {
          const pattern = trimmed.split('=')[1].trim().replace(/['"]/g, '');
          if (!config.routes) config.routes = [];
          config.routes.push({ pattern });
        }
      }
      
      return config;
    } else {
      // JSON parsing
      return JSON.parse(content) as WranglerConfig;
    }
  } catch (error) {
    return {};
  }
}

function extractDomains(config?: WranglerConfig): string[] {
  if (!config) return [];
  
  const domains: string[] = [];
  
  if (config.routes) {
    config.routes.forEach(route => {
      if (route.pattern && !route.pattern.includes('*')) {
        domains.push(route.pattern);
      }
    });
  }
  
  if (config.route?.pattern && !config.route.pattern.includes('*')) {
    domains.push(config.route.pattern);
  }
  
  return domains;
}

function generateDashboard(data: any, format: 'html' | 'md'): string {
  const { username, repositories, isOwner, currentUser } = data;
  
  if (format === 'md') {
    return generateMarkdownDashboard(data);
  }
  
  const workerRepos = repositories.filter((repo: RepositoryWithWorker) => repo.isWorker);
  const otherRepos = repositories.filter((repo: RepositoryWithWorker) => !repo.isWorker);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${username} - Flaredream Dashboard</title>
    <script type="application/json" id="dashboard-data">
    ${JSON.stringify({ cache: Date.now(), username })}
    </script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a1810 100%);
            color: #ffffff;
            min-height: 100vh;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
            padding: 1.5rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 107, 53, 0.2);
        }
        .header h1 {
            font-size: 2rem;
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .header-actions {
            display: flex;
            gap: 1rem;
        }
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
        }
        .btn-primary {
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            color: white;
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            border: 1px solid rgba(255, 107, 53, 0.3);
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
        }
        .lmpify-chat {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            text-decoration: none;
            font-size: 1.5rem;
            box-shadow: 0 4px 20px rgba(255, 107, 53, 0.4);
            z-index: 1000;
        }
        .section {
            margin-bottom: 3rem;
        }
        .section h2 {
            font-size: 1.5rem;
            margin-bottom: 1rem;
            color: #ff6b35;
        }
        .repo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
            gap: 1.5rem;
        }
        .repo-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 12px;
            padding: 1.5rem;
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
        }
        .repo-card:hover {
            border-color: rgba(255, 107, 53, 0.4);
            transform: translateY(-2px);
        }
        .repo-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1rem;
        }
        .repo-name {
            font-size: 1.2rem;
            font-weight: 600;
            color: #ffffff;
        }
        .worker-badge {
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .repo-description {
            color: #ccc;
            margin-bottom: 1rem;
            line-height: 1.5;
        }
        .repo-meta {
            display: flex;
            gap: 1rem;
            margin-bottom: 1rem;
            font-size: 0.875rem;
            color: #888;
        }
        .repo-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }
        .repo-actions .btn {
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
        }
        .domains {
            margin-top: 0.5rem;
        }
        .domain-link {
            display: inline-block;
            background: rgba(255, 107, 53, 0.1);
            color: #ff6b35;
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
            text-decoration: none;
            font-size: 0.75rem;
            margin-right: 0.5rem;
            margin-bottom: 0.5rem;
        }
        @media (max-width: 768px) {
            .repo-grid { grid-template-columns: 1fr; }
            .header { flex-direction: column; gap: 1rem; }
            .repo-actions { justify-content: center; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>${username}'s Dashboard</h1>
                <p style="color: #888; margin-top: 0.5rem;">${repositories.length} repositories</p>
            </div>
            <div class="header-actions">
                <a href="/${username}/refresh" class="btn btn-secondary">🔄 Refresh</a>
                ${!currentUser ? '<a href="/login" class="btn btn-primary">🔐 Login</a>' : 
                  currentUser.login !== username ? '<a href="/logout" class="btn btn-secondary">Logout</a>' : 
                  '<a href="/logout" class="btn btn-secondary">Logout</a>'}
            </div>
        </div>

        ${workerRepos.length > 0 ? `
        <div class="section">
            <h2>⚡ Cloudflare Workers (${workerRepos.length})</h2>
            <div class="repo-grid">
                ${workerRepos.map(repo => generateRepoCard(repo)).join('')}
            </div>
        </div>
        ` : ''}

        ${otherRepos.length > 0 ? `
        <div class="section">
            <h2>📚 Other Repositories (${otherRepos.length})</h2>
            <div class="repo-grid">
                ${otherRepos.map(repo => generateRepoCard(repo)).join('')}
            </div>
        </div>
        ` : ''}
    </div>

    <a href="https://lmpify.com/https://flaredream.com/${username}" class="lmpify-chat" title="Chat with AI about this dashboard">
        🤖
    </a>

    <script>
        // Auto-refresh functionality
        const data = JSON.parse(document.getElementById('dashboard-data').textContent);
        if (!data.cache || Date.now() - data.cache > 300000) { // 5 minutes
            window.location.href = '/${username}/refresh';
        }
    </script>
</body>
</html>`;
}

function generateRepoCard(repo: RepositoryWithWorker): string {
  const repoActions = [
    `<a href="${repo.html_url}" class="btn btn-secondary" target="_blank">📖 GitHub</a>`,
    `<a href="https://github.dev/${repo.owner.login}/${repo.name}" class="btn btn-secondary" target="_blank">💻 Code</a>`,
    `<a href="https://lmpify.com/https://uithub.com/${repo.owner.login}/${repo.name}" class="btn btn-secondary" target="_blank">🤖 Chat</a>`,
    `<a href="https://uithub.com/${repo.owner.login}/${repo.name}" class="btn btn-secondary" target="_blank">🔗 uithub</a>`
  ];

  if (repo.isWorker) {
    const accountPlaceholder = ':account';
    repoActions.push(
      `<a href="https://dash.cloudflare.com/?to=/${accountPlaceholder}/workers-and-pages/create/deploy-to-workers&repository=${repo.html_url}" class="btn btn-primary" target="_blank">🚀 Deploy</a>`,
      `<a href="https://dash.cloudflare.com/?to=/${accountPlaceholder}/workers-and-pages/create/workers/provider/github/${repo.owner.login}/${repo.name}/configure" class="btn btn-secondary" target="_blank">⚙️ Configure</a>`,
      `<a href="https://dash.cloudflare.com/?to=/${accountPlaceholder}/workers/services/view/${repo.name}/production/deployments" class="btn btn-secondary" target="_blank">📊 Deployments</a>`
    );
  }

  const domains = repo.domains && repo.domains.length > 0 ? 
    `<div class="domains">
       ${repo.domains.map(domain => `<a href="https://${domain}" class="domain-link" target="_blank">${domain}</a>`).join('')}
     </div>` : '';

  return `
    <div class="repo-card">
        <div class="repo-header">
            <div class="repo-name">${repo.name}</div>
            ${repo.isWorker ? '<div class="worker-badge">⚡ Worker</div>' : ''}
        </div>
        ${repo.description ? `<div class="repo-description">${repo.description}</div>` : ''}
        <div class="repo-meta">
            ${repo.language ? `<span>📝 ${repo.language}</span>` : ''}
            <span>⭐ ${repo.stargazers_count}</span>
            <span>🍴 ${repo.forks_count}</span>
            <span>📦 ${Math.round(repo.size / 1024)}KB</span>
        </div>
        ${domains}
        <div class="repo-actions">
            ${repoActions.join('')}
        </div>
    </div>
  `;
}

function generateMarkdownDashboard(data: any): string {
  const { username, repositories, isOwner } = data;
  const workerRepos = repositories.filter((repo: RepositoryWithWorker) => repo.isWorker);
  const otherRepos = repositories.filter((repo: RepositoryWithWorker) => !repo.isWorker);

  let markdown = `# ${username}'s Dashboard\n\n`;
  markdown += `Total repositories: ${repositories.length}\n\n`;

  if (workerRepos.length > 0) {
    markdown += `## ⚡ Cloudflare Workers (${workerRepos.length})\n\n`;
    workerRepos.forEach((repo: RepositoryWithWorker) => {
      markdown += generateRepoMarkdown(repo);
    });
  }

  if (otherRepos.length > 0) {
    markdown += `## 📚 Other Repositories (${otherRepos.length})\n\n`;
    otherRepos.forEach((repo: RepositoryWithWorker) => {
      markdown += generateRepoMarkdown(repo);
    });
  }

  return markdown;
}

function generateRepoMarkdown(repo: RepositoryWithWorker): string {
  let markdown = `### ${repo.name}\n\n`;
  
  if (repo.description) {
    markdown += `${repo.description}\n\n`;
  }

  markdown += `**Stats:** ⭐ ${repo.stargazers_count} | 🍴 ${repo.forks_count} | 📦 ${Math.round(repo.size / 1024)}KB`;
  if (repo.language) {
    markdown += ` | 📝 ${repo.language}`;
  }
  markdown += '\n\n';

  if (repo.domains && repo.domains.length > 0) {
    markdown += `**Domains:** ${repo.domains.map(domain => `[${domain}](https://${domain})`).join(', ')}\n\n`;
  }

  markdown += `**Links:** [GitHub](${repo.html_url}) | [Code](https://github.dev/${repo.owner.login}/${repo.name}) | [Chat](https://lmpify.com/https://uithub.com/${repo.owner.login}/${repo.name}) | [uithub](https://uithub.com/${repo.owner.login}/${repo.name})`;

  if (repo.isWorker) {
    const accountPlaceholder = ':account';
    markdown += ` | [🚀 Deploy](https://dash.cloudflare.com/?to=/${accountPlaceholder}/workers-and-pages/create/deploy-to-workers&repository=${repo.html_url}) | [⚙️ Configure](https://dash.cloudflare.com/?to=/${accountPlaceholder}/workers-and-pages/create/workers/provider/github/${repo.owner.login}/${repo.name}/configure)`;
  }

  markdown += '\n\n---\n\n';
  return markdown;
}