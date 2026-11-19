pipeline {
  agent { label 'docker' }
  options { disableConcurrentBuilds(); timestamps() }
  parameters {
    string(name: 'RELEASE_IMAGE', description: 'GHCR repository and full commit SHA tag')
  }
  stages {
    stage('Verify release in staging') {
      steps {
        sh '''
          set -eu
          printf '%s\n' "$RELEASE_IMAGE" | grep -Eq '^ghcr[.]io/[a-z0-9._/-]+:[a-f0-9]{40}$'
          export BOOKING_IMAGE="$RELEASE_IMAGE" BOOKING_PORT=3012
          export COMPOSE_PROJECT_NAME="tatkal-jenkins-$BUILD_NUMBER"
          trap 'docker compose logs --tail 40; docker compose down --volumes' EXIT
          docker compose pull
          docker compose up -d --no-build --wait --wait-timeout 120
          curl -fsS http://127.0.0.1:3012/api/health |
            jq -e --arg sha "${RELEASE_IMAGE##*:}" '.storage=="postgres" and .release==$sha'
          npm ci
          npx playwright-core install chromium
          docker compose run --rm --no-deps -v "$PWD/backend/ci:/app/backend/ci:ro" \
            -e CI_DATABASE_URL=postgres://tatkal:tatkal_local@db:5432/booking \
            app backend/ci/postgres.js
          BROWSER_STAGING_ORIGIN=http://127.0.0.1:3012 npm run test:browser
        '''
      }
    }
    stage('Approve release') {
      input { message 'Promote this verified image to the configured demo host?' }
      steps {
        sh 'bash deploy/promote.sh "$RELEASE_IMAGE"'
      }
    }
  }
}
