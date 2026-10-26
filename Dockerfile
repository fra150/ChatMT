# ChatMT — container image for the Phase 2 prototype.
#
# The application runs entirely in the browser: the modules under modules/ are ES modules
# loaded by the page, and the memory lives in the browser storage of the visitor. There is
# therefore no build step and no application server in this image. nginx only serves the
# project files, which is what ES modules and fetch() require (opening index.html directly
# from the file system does not work because of the browser security rules).
#
# Build:  docker build -t chatmt .
# Run:    docker run --rm -p 8080:80 chatmt
# Open:   http://localhost:8080/          (redirects to /frontend/)

FROM nginx:alpine

LABEL org.opencontainers.image.title="ChatMT" \
      org.opencontainers.image.description="Reflective and regenerative AI prototype — colour preference engine (phase 2)" \
      org.opencontainers.image.source="https://github.com/ChatMT-23/ChatMT"

# The whole project is served as it is: no copy of the sources, no generated bundle.
COPY . /usr/share/nginx/html

# Replace the default site: send the root URL to the application, and answer 404 for
# anything that does not exist instead of showing the nginx landing page.
RUN printf 'server {\n  listen 80;\n  listen [::]:80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location = / { return 302 /frontend/; }\n  location / { try_files $uri $uri/ =404; }\n}\n' \
      > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --quiet --tries=1 --spider http://localhost/frontend/index.html || exit 1
