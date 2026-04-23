variable "billing_account" {
  description = "The ID of the billing account to associate projects with"
  type        = string
  default     = "013AD7-561041-013280"
}

variable "org_id" {
  description = "The organization id for the associated resources"
  type        = string
  default     = "52737176173"
}

variable "billing_project" {
  description = "The project id to use for billing"
  type        = string
  default     = "cs-host-6578e3251b9f4df490804d"
}

variable "folders" {
  description = "Folder structure as a map"
  type        = map
}

variable "application_enabled_folder_paths" {
  description = "The folder paths to enable resource manager capability"
  type        = list
}

variable "cmek_autokey_folders" {
  description = "Folders for CMEK autokey encryption"
  type        = list
}
