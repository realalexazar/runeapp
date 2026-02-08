export const ESP_REGISTRABLE_BLOCKLIST: string[] = [
  "amazonses.com",
  "sparkpost.com",
  "sparkpostmail.com",
  "mtasv.net",
  "sendgrid.net",
  "mailgun.org",
  "mandrillapp.com",
  "postmarkapp.com",
  "mailchimp.com",
  "sailthru.com",
  "cmail20.com",
  "kmail-lists.com",
  "klaviyo.com",
  "sendinblue.com",
  "constantcontact.com",
  "campaignmonitor.com",
  "salesforce.com" // Marketing Cloud / Pardot ESP
]

export function isEspRegistrableDomain(registrable: string | null | undefined): boolean {
  if (!registrable) return false
  return ESP_REGISTRABLE_BLOCKLIST.includes(registrable)
}

export const telemetry = {
  senderKey: {
    dkimAligned: 0,
    dkimNonEsp: 0,
    fromFallback: 0,
    returnPathFallback: 0,
    messageIdFallback: 0,
    espDetected: 0,
    unknownEspHits: 0,
  }
}


