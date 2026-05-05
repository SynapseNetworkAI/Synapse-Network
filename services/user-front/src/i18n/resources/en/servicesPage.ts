import type { I18nMessages } from "@/i18n/schema";

const servicesPage: I18nMessages["servicesPage"] = {
  confirmActivate:
    "Activate service {{serviceId}}? It will appear for discovery again only when health checks report healthy targets.",
  confirmDeactivate:
    "Set service {{serviceId}} to inactive? New discovery and direct gateway forwarding requests will be blocked after this update.",
  serviceActivated: "Service activated",
  serviceSetInactive: "Service set to inactive",
  updateStatusFailed: "Failed to update service status",
  confirmDelete:
    "Delete service {{serviceId}}? This is a logical delete. The service will be marked as deleted, removed from your active service list, and kept only for audit history.",
  serviceDeleted: "Service deleted",
  deleteFailed: "Failed to delete service",
  loadFailed: "Failed to load services",
  healthHistoryLoadFailed:
    "Failed to load service health history. Please retry after the gateway reconnects.",
  activeEditBlocked:
    "Active services can't be edited. Set the service to Inactive first.",
  inactiveOnlyEditBlocked: "Only inactive services can be edited.",
  walletNotConnected: "Wallet not connected.",
  walletNotConnectedDescription:
    "Connect and sign in to manage your API services and service definitions.",
  sessionNotAuthenticated: "Session not authenticated yet.",
  sessionNotAuthenticatedDescription:
    "Sign in with wallet to view and manage your private service definitions.",
  loading: "Loading Synapses...",
  emptyTitle: "No Services Found",
  emptyDescription: "You haven't created any service definitions yet.",
  createFirstService: "Create First Service",
  actionActivate: "Activate",
  actionUpdating: "Updating...",
  actionInactive: "Inactive",
  statusActive: "Active",
  statusInactive: "Inactive",
  fieldEndpoint: "Endpoint",
  fieldPricing: "Pricing",
  editInactiveService: "Edit inactive service",
  setInactiveBeforeEditing: "Set service to Inactive before editing",
  editService: "Edit Service",
  deleting: "Deleting...",
  delete: "Delete",
  health: "Health",
  title: "My Services",
  description: "Manage API services, service definitions, and endpoint health.",
  backToDashboard: "Back to Dashboard",
  newService: "New Service",
  footerNote:
    "Active services are runtime-live. Switch a service to Inactive before editing its contract or routing fields.",
};

export default servicesPage;
