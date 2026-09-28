Only for building the image behind a TLS-inspecting proxy: put the proxy's CA
certificate(s) here as `*.pem` (they are git-ignored). The build trusts them for
package downloads and removes them from the runtime image. Leave this directory
empty otherwise.
