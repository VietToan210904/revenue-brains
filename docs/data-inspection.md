# Data Inspection

Use this guide to inspect what Revenue Brains saved during local MVP runs.

## Start Local Services

```powershell
docker compose up -d postgres qdrant
```

Open Prisma Studio from the repo root:

```powershell
npm run db:studio
```

Prisma Studio usually opens at:

```txt
http://localhost:5555
```

Open Qdrant dashboard:

```txt
http://localhost:6333/dashboard
```

## What Lives Where

- `uploads/`: original private uploaded files.
- Postgres: conversations, messages, documents, jobs, agent runs, agent steps, extracted records, fields, source references, vector references, and webhook attempts.
- Qdrant: semantic document chunks, embeddings, and payload metadata for retrieval.

## Postgres SQL

Open `psql`:

```powershell
docker exec -it revenue-brains-postgres psql -U revenue_brains -d revenue_brains
```

Recent documents:

```sql
select id, "originalFilename", "documentType", status, "storageKey", "createdAt"
from "Document"
order by "createdAt" desc
limit 20;
```

Recent agent runs:

```sql
select id, status, "detectedIntent", "automationDecision", "finalReply", "createdAt"
from "AgentRun"
order by "createdAt" desc
limit 20;
```

Agent timeline:

```sql
select "agentRunId", sequence, "agentName", action, status, "outputSummary"
from "AgentStep"
order by "agentRunId", sequence;
```

Extracted records:

```sql
select id, "documentId", "documentType", title, confidence, "validationStatus", "createdAt"
from "ExtractedRecord"
order by "createdAt" desc
limit 20;
```

Extracted fields:

```sql
select "documentId", name, "fieldType", "valueString", "valueNumber", "valueDate", currency, confidence, "validationStatus"
from "ExtractedField"
order by "createdAt" desc
limit 50;
```

Source references:

```sql
select "documentId", "extractedFieldId", "pageNumber", "lineStart", "evidenceSnippet"
from "SourceReference"
order by "createdAt" desc
limit 50;
```

Vector references:

```sql
select "documentId", "qdrantCollection", "qdrantPointId", "chunkIndex", "contentPreview"
from "VectorReference"
order by "createdAt" desc
limit 50;
```

Webhook attempts:

```sql
select id, "eventType", status, "webhookUrl", "responseStatusCode", "errorMessage", "createdAt"
from "WebhookSyncAttempt"
order by "createdAt" desc
limit 50;
```

## Qdrant Payloads

List collections:

```powershell
Invoke-RestMethod -Uri "http://localhost:6333/collections" | ConvertTo-Json -Depth 10
```

Inspect the default collection:

```powershell
Invoke-RestMethod -Uri "http://localhost:6333/collections/revenue_brains_documents" | ConvertTo-Json -Depth 10
```

Scroll points without returning large vectors:

```powershell
$body = @{
  limit = 10
  with_payload = $true
  with_vector = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:6333/collections/revenue_brains_documents/points/scroll" `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json -Depth 10
```

Expected Qdrant payload metadata includes:

```txt
workspaceId
conversationId
messageId
documentId
filename
chunkIndex
documentType
chunkId
contentPreview
```

Use `VectorReference.qdrantPointId` in Postgres to connect exact records back to Qdrant points.
