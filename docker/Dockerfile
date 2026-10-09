FROM nginx:alpine

# Copy static website files
COPY . /usr/share/nginx/html/

# Configure nginx with basic optimization and logging to stdout/stderr
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html index.htm; \
    \
    # Enable access logging to stdout \
    access_log /dev/stdout; \
    error_log /dev/stderr; \
    \
    # Enable gzip compression \
    gzip on; \
    gzip_vary on; \
    gzip_types text/plain text/css application/json application/javascript; \
    \
    # Ensure sw.js and index.html are never forcefully cached by HTTP \
    location ~* (?:index\\.html|sw\\.js)$ { \
        expires -1; \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
    } \
    \
    # Long-term cache settings for static assets \
    location ~* \\.(?:css|js|jpg|jpeg|gif|png|ico|svg|webp|woff2?|ttf)$ { \
        expires 30d; \
        add_header Cache-Control "public, max-age=2592000"; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Forward nginx logs to Docker log collector
RUN ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
