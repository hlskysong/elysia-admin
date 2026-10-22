import { normalizeLocations, sitePaths } from './site';

function nginxQuote(value: string): string {
    return value.replace(/\\/g, '/');
};

function proxyBlock(locationPath: string, port: number, hostHeader: string, options?: { read?: string; send?: string; extra?: string[] }): string {
    const read = options?.read || '86400s';
    const send = options?.send || '30s';
    return [
        `    location ${locationPath} {`,
        `        proxy_pass http://127.0.0.1:${port};`,
        `        proxy_set_header Host ${hostHeader};`,
        '        proxy_set_header X-Real-IP $remote_addr;',
        '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
        '        proxy_set_header X-Forwarded-Proto $scheme;',
        '        proxy_connect_timeout 30s;',
        `        proxy_read_timeout ${read};`,
        `        proxy_send_timeout ${send};`,
        '        proxy_http_version 1.1;',
        '        proxy_set_header Upgrade $http_upgrade;',
        '        proxy_set_header Connection "upgrade";',
        ...(options?.extra || []).map((line) => `        ${line}`),
        '    }',
    ].join('\n');
};

/**
 * 生成 Nginx 配置文本
 * @param site 站点档案
 * @param mode httpOnly 为仅 80 端口；ssl 为含证书的完整配置
 * @returns 配置全文
 */
export function renderNginx(site: Record<string, any>, mode: 'httpOnly' | 'ssl'): string {
    const paths = sitePaths(site);
    const locations = normalizeLocations(site.locations);
    const name = String(site.name);
    const serverName = String(site.serverName);
    const lines: string[] = [
        'server',
        '{',
        '    listen 80;',
    ];
    if (mode === 'ssl') {
        lines.push(
            '    listen 443 ssl;',
            '    listen 443 quic;',
            '    http2 on;',
        );
    };
    lines.push(`    server_name ${serverName};`, '    index index.html index.htm default.htm default.html;');
    if (site.useBaota !== false) {
        lines.push(
            `    include /www/server/panel/vhost/nginx/extension/${name}/*.conf;`,
            '    #CERT-APPLY-CHECK--START',
            `    include /www/server/panel/vhost/nginx/well-known/${name}.conf;`,
            '    #CERT-APPLY-CHECK--END',
        );
    };
    if (mode === 'ssl' && site.httpRedirect !== false) {
        lines.push(
            '    set $isRedcert 1;',
            '    if ($server_port != 443) {',
            '        set $isRedcert 2;',
            '    }',
            '    if ( $uri ~ /\\.well-known/ ) {',
            '        set $isRedcert 1;',
            '    }',
            '    if ($isRedcert != 1) {',
            '        rewrite ^(/.*)$ https://$host$1 permanent;',
            '    }',
        );
    };
    if (mode === 'ssl') {
        const certDir = nginxQuote(paths.certDir);
        lines.push(
            `    ssl_certificate    ${certDir}/fullchain.pem;`,
            `    ssl_certificate_key    ${certDir}/privkey.pem;`,
            '    ssl_protocols TLSv1.2 TLSv1.3;',
            '    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:!MD5:!3DES:!aNULL:!eNULL;',
            '    ssl_prefer_server_ciphers on;',
            '    ssl_session_tickets on;',
            '    ssl_session_cache shared:SSL:10m;',
            '    ssl_session_timeout 10m;',
            '    add_header Strict-Transport-Security "max-age=31536000";',
            `    add_header Alt-Svc 'quic=":443"; h3=":443"; h3-29=":443"; h3-27=":443";h3-25=":443"; h3-T050=":443"; h3-Q050=":443";h3-Q049=":443";h3-Q048=":443"; h3-Q046=":443"; h3-Q043=":443"';`,
            '    error_page 497  https://$host$request_uri;',
        );
    };
    lines.push(
        '    location ~* (\\.user\\.ini|\\.htaccess|\\.htpasswd|\\.env.*|\\.project|\\.bashrc|\\.bash_profile|\\.bash_logout|\\.DS_Store|\\.gitignore|\\.gitattributes|LICENSE|README\\.md|CLAUDE\\.md|CHANGELOG\\.md|CHANGELOG|CONTRIBUTING\\.md|TODO\\.md|FAQ\\.md|composer\\.json|composer\\.lock|package(-lock)?\\.json|yarn\\.lock|pnpm-lock\\.yaml|\\.\\w+~|\\.swp|\\.swo|\\.bak(up)?|\\.old|\\.tmp|\\.temp|\\.log|\\.sql(\\.gz)?|docker-compose\\.yml|docker\\.env|Dockerfile|\\.csproj|\\.sln|Cargo\\.toml|Cargo\\.lock|go\\.mod|go\\.sum|phpunit\\.xml|pom\\.xml|build\\.gradl|pyproject\\.toml|requirements\\.txt|application(-\\w+)?\\.(ya?ml|properties))$',
        '    {',
        '        return 404;',
        '    }',
        '    location ~* /(\\.git|\\.svn|\\.bzr|\\.vscode|\\.claude|\\.idea|\\.ssh|\\.github|\\.npm|\\.yarn|\\.pnpm|\\.cache|\\.husky|\\.turbo|\\.next|\\.nuxt|node_modules|runtime)/ {',
        '        return 404;',
        '    }',
        '    location /.well-known/ {',
        `        root ${nginxQuote(paths.webRoot)};`,
        '    }',
        '    if ( $uri ~ "^/\\.well-known/.*\\.(php|jsp|py|js|css|lua|ts|go|zip|tar\\.gz|rar|7z|sql|bak)$" ) {',
        '        return 403;',
        '    }',
    );
    if (site.useBaota !== false) {
        lines.push(`    include /www/server/panel/vhost/rewrite/node_${name}.conf;`);
    };
    const blocks = locations.map((item) => {
        const asStatic = item.kind === 'admin' || (item.kind === 'custom' && item.serve === 'static');
        if (asStatic) {
            const adminRoot = nginxQuote(item.root || site.wwwRoot || paths.webRoot);
            const title = item.kind === 'custom' && item.name ? [`    # ${item.name}`] : [];
            return {
                path: item.path,
                text: [
                    ...title,
                    `    location ${item.path} {`,
                    `        root ${adminRoot};`,
                    '        index index.html;',
                    `        try_files $uri $uri/ ${item.path}/index.html;`,
                    '    }',
                ].join('\n'),
            };
        }
        if (item.kind === 'rustfs') {
            // Host 用 $host，与浏览器访问域名一致，避免写死 server_name 导致预签名 Host 不一致
            return {
                path: item.path,
                text: [
                    '    # RustFS 只反代到 127.0.0.1，不要在防火墙或进程上对外开放该端口',
                    proxyBlock(item.path, Number(item.port), '$host', {
                        read: '300s',
                        send: '300s',
                        extra: [`client_max_body_size ${item.maxBody || '50m'};`],
                    }),
                ].join('\n'),
            };
        }
        const extra = item.maxBody ? [`client_max_body_size ${item.maxBody};`] : [];
        const title = item.kind === 'custom' && item.name ? [`    # ${item.name}`] : [];
        return {
            path: item.path,
            text: [
                ...title,
                proxyBlock(item.path, Number(item.port), '$host:$server_port', extra.length ? { extra } : undefined),
            ].join('\n'),
        };
    });
    blocks.sort((a, b) => b.path.length - a.path.length);
    for (const block of blocks) lines.push(block.text);
    // 默认不生成 proxy_cache_purge：未开启对应缓存模块时会告警
    if (site.useBaota !== false) {
        lines.push(
            `    access_log  /www/wwwlogs/${name}.log;`,
            `    error_log  /www/wwwlogs/${name}.error.log;`,
        );
    }
    lines.push('}');
    return lines.join('\n');
};
