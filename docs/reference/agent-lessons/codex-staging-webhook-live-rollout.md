# codex/staging-webhook-live-rollout

- Keep staging webhook rollouts split across two PRs: runtime in `Synapse-Network`, release-governance in `Synapse-Network-Growing`.
- For staging gateway live verification, check the deployed revision first, then verify `GET/POST` behavior on both the custom domain and the direct `run.app` URL before assuming an env-only misconfiguration.
- Growing local deploy commands must carry explicit `--project` and `--region`, and staging should fail closed if the target project is not `fabled-archive-494108-k5`.
