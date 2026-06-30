# Architecture — Azure SDK Release Management Automation

This document describes the existing components, data flows, and key entry points for Azure SDK release management automation in the `Azure/azure-sdk-tools` repository.

## Overview

The Azure SDK release management process involves:
1. **Release Plan Work Items** — Azure DevOps work items tracking package releases across languages
2. **Release Notes Generation** — Automated PRs to `Azure/azure-sdk` with language-specific release notes
3. **Version & Changelog Management** — Scripts that update package versions and changelog entries
4. **Release Dashboard** — Web UI for viewing release plan status and PR progress
5. **Release Status Tracking** — Updates to release plans when packages are published

## Components

### 1. Release Plan Dashboard (`tools/release-plan-dashboard/`)

**Purpose**: Web application displaying release plan work items from Azure DevOps with GitHub PR enrichment.

**Key Files**:
- `server.js` — Express entry point, Easy Auth middleware
- `lib/devops-api.js` — Azure DevOps WIQL queries, work item mapping
- `lib/github-api.js` — GitHub PR status/details via Octokit
- `lib/cache.js` — In-memory cache (release plans: 1hr TTL, PR details: 15min TTL)
- `lib/rate-limit.js` — Sliding-window rate limiter
- `routes/api.js` — API route handlers (`/api/release-plans`, `/api/pr-details`)
- `public/app.js` — Vanilla JS SPA (2100+ lines) with card rendering and action determination

**Data Flow**:
1. Server mints GitHub App token via Azure Key Vault
2. Fetches release plans from Azure DevOps `Release` project using DefaultAzureCredential
3. Caches data server-side (auto-refreshes every hour)
4. Client fetches `/api/release-plans` for cached data
5. Client requests `/api/pr-details` on-demand for PR enrichment

**Auth**: Azure App Service Easy Auth (Microsoft Entra ID), rate-limited per user (30 req/min)

**DevOps Fields Tracked**:
```
Release Plan: System.Id, System.Title, System.State, Custom.SDKReleasemonth,
              Custom.SDKtypetobereleased, Custom.ReleasePlanID, Custom.ApiSpecProjectPath,
              Custom.ProductName, Custom.ServiceName, Custom.ReleasePlanType

Per Language (Dotnet, JavaScript, Python, Java, Go):
  - Custom.SDKPullRequestFor{Lang}
  - Custom.SDKPullRequestStatusFor{Lang}
  - Custom.ReleaseStatusFor{Lang}
  - Custom.GenerationStatusFor{Lang}
  - Custom.ReleaseExclusionStatusFor{Lang}
  - Custom.ReleasedVersionFor{Lang}
  - Custom.{Lang}PackageName
```

### 2. Release Plan CLI Tools (`tools/azsdk-cli/Azure.Sdk.Tools.Cli/Tools/ReleasePlan/`)

**Purpose**: Command-line and MCP tools for creating, updating, and managing release plan work items.

**Key Files**:
- `ReleasePlanTool.cs` — Main tool with MCP endpoints (create, get, update, abandon, link)
- `PackageReleaseStatusTool.cs` — Updates package release status in release plans
- `Models/AzureDevOps/ReleasePlanWorkItem.cs` — Release plan data model
- `Services/IDevOpsService.cs` — Azure DevOps API client

**MCP Tools**:
- `azsdk_create_release_plan` — Creates release plan work item with spec PR, TypeSpec path, languages
- `azsdk_get_release_plan` — Fetches release plan by ID or TypeSpec path
- `azsdk_update_release_plan` — Updates release plan metadata (spec PR, SDK release type, service IDs)
- `azsdk_update_sdk_details_in_release_plan` — Updates package names for each language
- `azsdk_link_sdk_pull_request_to_release_plan` — Links SDK PRs to release plan
- `azsdk_abandon_release_plan` — Marks release plan as abandoned
- `azsdk release-plan update-release-status` — Updates `Custom.ReleaseStatusFor{Lang}` field

**Auto-Completion Logic** (`PackageReleaseStatusTool.cs:230-242`):
- When a package is marked "Released", checks if all required languages are complete
- Required languages: Management = [.NET, Java, JavaScript, Python, Go], Data = [.NET, Java, JavaScript, Python]
- If all languages are "Released" OR "Approved" exclusion, marks release plan State = "Finished"

### 3. Release Preparation Scripts (`eng/common/scripts/`)

**Purpose**: PowerShell scripts for versioning, changelog management, and release tracking.

**Key Files**:

#### `Prepare-Release.ps1`
- Reads current package version from project
- Creates/updates DevOps release work item (`FindOrCreateClonePackageWorkItem`)
- Validates changelog has entry for release version
- Calls `Update-DevOps-Release-WorkItem.ps1` to set work item fields
- Checks APIView status via Key Vault secrets
- Sets package version and release date (`SetPackageVersion`)

**Usage**: `./Prepare-Release.ps1 <PackageName> [-ServiceDirectory <dir>] [-ReleaseDate MM/dd/yyyy] [-ReleaseTrackingOnly]`

#### `Update-ChangeLog.ps1`
- Adds or replaces version title in CHANGELOG.md
- Supports "Unreleased" status or specific release date
- Parses existing changelog entries, inserts new entry at top
- Replaces latest entry title if `-ReplaceLatestEntryTitle $true`

**Usage**: `./Update-ChangeLog.ps1 -Version <ver> -PackageName <name> [-ReleaseDate MM/dd/yyyy] [-Unreleased $true/$false]`

#### `Mark-ReleasePlanCompletion.ps1`
- Marks release plan completion after package is published
- Reads package info JSON (name, version)
- Calls `azsdk release-plan update-release-status` via `azsdk-cli` executable
- Updates `ReleaseStatusFor{Lang}` to "Released" and sets `ReleasedVersionFor{Lang}`

**Usage**: `./Mark-ReleasePlanCompletion.ps1 -PackageInfoFilePath <path> -AzsdkExePath <path>`

#### `Update-DevOps-Release-WorkItem.ps1`
- Creates or updates "Package" work item for release tracking
- Calls `FindOrCreateClonePackageWorkItem` helper
- Sets fields: `Custom.Package`, `Custom.Language`, `Custom.PackageVersion`, `System.State` = "In Release"
- Updates planned versions with release date

**Usage**: `./Update-DevOps-Release-WorkItem.ps1 -language <lang> -packageName <name> -version <ver> -plannedDate MM/dd/yyyy`

#### `Helpers/DevOps-WorkItem-Helpers.ps1`
- `Get-DevOpsRestHeaders()` — Mints DevOps access token from `az cli`
- `Invoke-Query()` — Executes WIQL queries
- `FindOrCreateClonePackageWorkItem()` — Finds or creates Package work item
- `UpdatePackageWorkItemReleaseState()` — Sets work item state
- `UpdatePackageVersions()` — Updates planned version fields

### 4. Release Completion Pipeline (`eng/common/pipelines/templates/steps/mark-release-completion.yml`)

**Purpose**: CI step that marks release plan as "Released" after package publication.

**Steps**:
1. Installs `azsdk-cli` tool via `install-azsdk-cli.yml`
2. Runs `Mark-ReleasePlanCompletion.ps1` with package info JSON
3. Uses Azure CLI authentication (`azureSubscription: opensource-api-connection`)
4. `continueOnError: true` — doesn't fail pipeline if release plan doesn't exist

**Usage in Pipelines**:
```yaml
- template: /eng/common/pipelines/templates/steps/mark-release-completion.yml
  parameters:
    ConfigFileDir: $(Build.ArtifactStagingDirectory)
    PackageArtifactName: <package-name>
```

### 5. Release Notes Policy & Automation

**Policy Documentation**: `https://azure.github.io/azure-sdk/policies_releasenotes.html`

**Process**:
1. **Automated PRs**: A pipeline (not in this repo) runs regularly and creates PRs with titles:
   - "dotnet release notes for the YYYY-MM release"
   - "java release notes for the YYYY-MM release"
   - "js release notes for the YYYY-MM release"
   - "python release notes for the YYYY-MM release"

2. **Generated Data**: `_data/releases/YYYY-MM/{language}.yml` in `Azure/azure-sdk` repo

3. **Review Process**:
   - Engineering leads suggest updates via GitHub suggestions
   - Release manager hides entries (set `Hidden: true`) for packages not in release
   - After code complete, release manager merges PR

4. **Content Sections**:
   - Package list with installation instructions
   - Developer impacting changes per package (Features, Breaking Changes, Bugs Fixed)
   - Boilerplate text with latest release links
   - Point-in-time download/source/docs links table

**Mentioned Pipelines** (not found in this repo):
- `azure-sdk-version-updater` — Creates/updates language release note PRs
- `generate-release-structure` — Generates monthly release sidebar nav for website

### 6. JavaScript Release Tools (`tools/js-sdk-release-tools/`)

**Purpose**: Tools for JavaScript SDK release automation (track2 mgmt, llc).

**Key Files**:
- `src/common/ciYamlTemplates/` — CI pipeline templates
- `docs/changelog-tool.md` — Changelog generation tool documentation
- `docs/automation-pipeline.md` — Pipeline architecture and generation steps

**Functionality** (based on docs):
- Automates changelog generation
- Updates version in `package.json`
- Updates user-agent/version metadata
- Folder cleanup logic
- SDK type generation

## Data Flow: Package Release

```
1. Developer releases package → Package published to feed (NuGet, PyPI, npm, Maven)
   
2. Release pipeline step → mark-release-completion.yml
   ↓
3. Mark-ReleasePlanCompletion.ps1 → Reads package info JSON
   ↓
4. Calls azsdk-cli → release-plan update-release-status
   ↓
5. PackageReleaseStatusTool → Updates DevOps work item
   - Queries "In Progress" release plans for package name
   - Updates Custom.ReleaseStatusFor{Lang} = "Released"
   - Updates Custom.ReleasedVersionFor{Lang} = version
   - If all languages complete → Sets System.State = "Finished"
   
6. Release Plan Dashboard → Auto-refreshes cache (hourly)
   ↓
7. Dashboard displays updated status → Users see "Released" badge
```

## Data Flow: Release Notes Generation

```
1. External pipeline (azure-sdk-version-updater) → Runs regularly
   ↓
2. Queries published packages from feeds (NuGet, PyPI, npm, Maven)
   ↓
3. Extracts changelog entries from published packages
   ↓
4. Generates/updates _data/releases/YYYY-MM/{lang}.yml
   ↓
5. Creates/updates PR in Azure/azure-sdk repo
   - Title: "{Language} release notes for the YYYY-MM release"
   - Automated updates as new packages publish
   
6. Engineering leads review → Suggest corrections via GitHub suggestions
   
7. Release manager review → Hides entries (Hidden: true), editorial pass
   
8. Release manager merges PR → Jekyll builds github.io site
   ↓
9. Release notes appear at https://azure.github.io/azure-sdk/releases/YYYY-MM/{lang}.html
```

## Key Entry Points

### For Release Plan Creation/Update:
- **CLI**: `azsdk release-plan create --typespec-path <path> --release-month "Month YYYY" ...`
- **MCP**: `azure-sdk-mcp:azsdk_create_release_plan` (via Copilot skills)
- **Script**: `./eng/common/scripts/Prepare-Release.ps1 <PackageName>`

### For Release Status Update:
- **Pipeline**: `mark-release-completion.yml` step in SDK release pipelines
- **CLI**: `azsdk release-plan update-release-status --package-name <name> --language <lang>`
- **Script**: `./eng/common/scripts/Mark-ReleasePlanCompletion.ps1 -PackageInfoFilePath <path>`

### For Viewing Release Plans:
- **Dashboard**: https://aka.ms/azsdk/releaseplan-dashboard
- **CLI**: `azsdk release-plan get --release-plan-id <id>`
- **MCP**: `azure-sdk-mcp:azsdk_get_release_plan`

### For Changelog/Version Management:
- **Script**: `./eng/common/scripts/Update-ChangeLog.ps1 -Version <ver> -PackageName <name>`
- **Script**: `./eng/common/scripts/Prepare-Release.ps1 <PackageName>`

## External Dependencies

- **Azure DevOps**: `https://dev.azure.com/azure-sdk` (Release project)
- **GitHub Repos**: `Azure/azure-sdk` (release notes), `Azure/azure-sdk-for-*` (SDK code)
- **Package Feeds**: NuGet, PyPI, npm, Maven Central (published packages)
- **Azure Key Vault**: `AzureSDKPrepRelease-KV` (APIView credentials)
- **Azure App Service**: Hosts release plan dashboard with Easy Auth
