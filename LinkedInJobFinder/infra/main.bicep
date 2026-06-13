// Hybrid cloud-mirror for LinkedIn Job Finder.
//
// What this deploys:
// - Storage Account with two containers (state, drafts)
// - App Service Plan B1 Linux
// - App Service running Python 3.11 + Streamlit, MI granted Blob Data Reader
// - Easy Auth (Microsoft identity provider) restricted to the user
//
// Caller must supply: appName (DNS-unique), allowedUserUpn (your Entra UPN /
// object id), and an Azure AI deployment to pass through.

@description('Globally-unique App Service / storage prefix, e.g. "kush-linkedinfinder".')
param appName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Your Entra ID object id (not UPN). Get with: az ad signed-in-user show --query id -o tsv')
param allowedUserObjectId string

@description('Azure AD tenant id. Get with: az account show --query tenantId -o tsv')
param tenantId string = subscription().tenantId

@description('Azure AI Inference endpoint passed through to the app.')
param azureAiEndpoint string = ''

@description('Azure AI Inference deployment name.')
param azureAiDeployment string = ''

@description('Azure AI Inference API key (stored as app setting).')
@secure()
param azureAiApiKey string = ''

var storageAccountName = toLower(replace('${appName}sa', '-', ''))
var appServicePlanName = '${appName}-plan'
var appServiceName = appName

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource stateContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'state'
  properties: { publicAccess: 'None' }
}

resource draftsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'drafts'
  properties: { publicAccess: 'None' }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: { name: 'B1', tier: 'Basic' }
  kind: 'linux'
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'PYTHON|3.11'
      appCommandLine: 'bash infra/startup.sh'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'ENABLE_ORYX_BUILD', value: 'false' }
        { name: 'WEBSITES_PORT', value: '8000' }
        { name: 'LINKEDIN_FINDER_REMOTE', value: '1' }
        { name: 'BLOB_ACCOUNT_URL', value: 'https://${storage.name}.blob.${environment().suffixes.storage}' }
        { name: 'BLOB_STATE_CONTAINER', value: 'state' }
        { name: 'BLOB_DRAFTS_CONTAINER', value: 'drafts' }
        { name: 'AZURE_AI_API_KEY', value: azureAiApiKey }
        { name: 'AZURE_AI_ENDPOINT', value: azureAiEndpoint }
        { name: 'AZURE_AI_DEPLOYMENT', value: azureAiDeployment }
        { name: 'AZURE_AI_API_VERSION', value: '2024-10-21' }
      ]
    }
  }
}

// Storage Blob Data Reader = 2a2b9908-6ea1-4ae2-8e65-a410df84e7d1
resource blobReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, 'Storage Blob Data Reader')
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
    )
  }
}

// Storage Blob Data Contributor = ba92f5b4-2d11-453d-a403-e96b0029c9fe — for the user (Mac).
resource blobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, allowedUserObjectId, 'Storage Blob Data Contributor')
  properties: {
    principalId: allowedUserObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    )
  }
}

// App Service Authentication V2 with Microsoft identity provider.
// Restricts access to the single allowed user via allowedPrincipals.identities.
resource authSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
          clientId: ''  // Filled by Easy Auth express-config after first deploy
        }
        validation: {
          allowedAudiences: []
          defaultAuthorizationPolicy: {
            allowedPrincipals: {
              identities: [ allowedUserObjectId ]
            }
          }
        }
      }
    }
    login: {
      tokenStore: { enabled: true }
    }
  }
}

output appUrl string = 'https://${app.properties.defaultHostName}'
output storageAccount string = storage.name
output blobAccountUrl string = 'https://${storage.name}.blob.${environment().suffixes.storage}'
