export type OAuthParams = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
  resource?: string;
};
