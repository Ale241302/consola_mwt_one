"""
=====================================================================
MWT.ONE · apps.ai_hub.models
Agente responsable: [AG-BACKEND-API]

Modelos ORM (Meta.managed=False) para el schema `ai`.
La DB la materializa A0_ai_module.sql; aquí sólo mapeamos.

Reglas MWT respetadas:
  · CERO ForeignKey (vínculos por UUIDField).
  · `managed = False` (Django nunca migra).
  · `db_table = 'ai"."<tabla>'` para schema-qualification correcta.
  · Cada tabla tiene id / is_active / created_at / updated_at,
    excepto ai.usage_log que es APPEND-ONLY (sin updated_at).
=====================================================================
"""
from django.db import models


# =====================================================================
# 1. AiAgent  — ai.agent
# =====================================================================
class AiAgent(models.Model):
    """Catálogo de agentes (personalidad + rol + prompt base)."""

    AUTONOMY_CHOICES = (
        ("read",    "Read"),
        ("suggest", "Suggest"),
        ("draft",   "Draft"),
        ("execute", "Execute"),
        ("deploy",  "Deploy"),
    )
    ROL_CHOICES = (
        ("architect", "Architect"),
        ("finance",   "Finance"),
        ("legal",     "Legal"),
        ("ops",       "Ops"),
        ("marketing", "Marketing"),
        ("hr",        "HR"),
        ("research",  "Research"),
        ("dev",       "Dev"),
        ("qa",        "QA"),
        ("analyst",   "Analyst"),
    )

    id                  = models.UUIDField(primary_key=True)
    codigo              = models.CharField(max_length=48)
    nombre              = models.CharField(max_length=120)
    rol                 = models.CharField(max_length=64, choices=ROL_CHOICES)
    descripcion         = models.TextField(null=True, blank=True)
    prompt_base         = models.TextField()
    autonomy_ceiling    = models.CharField(
        max_length=16, choices=AUTONOMY_CHOICES, default="suggest")
    avatar_emoji        = models.CharField(max_length=8, default="🤖")
    accent_color        = models.CharField(max_length=16, default="#00B286")
    model_default       = models.CharField(max_length=48, default="claude-sonnet-4-6")
    max_tokens_default  = models.IntegerField(default=4096)
    temperature_default = models.DecimalField(max_digits=3, decimal_places=2, default=0.30)
    tags                = models.JSONField(default=list)
    metadata            = models.JSONField(default=dict)
    created_by_id       = models.UUIDField(null=True, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ai"."agent'
        ordering = ("rol", "codigo")

    def __str__(self) -> str:
        return f"AiAgent({self.codigo} — {self.nombre})"


# =====================================================================
# 2. AiSkill  — ai.skill
# =====================================================================
class AiSkill(models.Model):
    """Catálogo de skills (habilidad + system_prompt)."""

    CATEGORY_CHOICES = (
        ("reasoning", "Reasoning"),
        ("writing",   "Writing"),
        ("analysis",  "Analysis"),
        ("coding",    "Coding"),
        ("search",    "Search"),
        ("math",      "Math"),
        ("vision",    "Vision"),
        ("audio",     "Audio"),
        ("custom",    "Custom"),
    )

    id                  = models.UUIDField(primary_key=True)
    codigo              = models.CharField(max_length=48)
    # Sprint Transfer Engine v3.5 (2026-04-30): columnas para routing LLM
    # creadas por SQL 91i_transfers_legal_documents.sql. Sin ellas, el
    # endpoint /api/ai/skills/<key>/ no puede hacer .filter(skill_key=...).
    skill_key           = models.CharField(max_length=64, null=True, blank=True)
    display_name        = models.CharField(max_length=160, null=True, blank=True)
    model_id            = models.CharField(max_length=64, null=True, blank=True)
    model_provider_id   = models.CharField(max_length=32, null=True, blank=True)

    nombre              = models.CharField(max_length=120)
    descripcion         = models.TextField(null=True, blank=True)
    system_prompt       = models.TextField()
    category            = models.CharField(
        max_length=48, choices=CATEGORY_CHOICES, null=True, blank=True)
    icon                = models.CharField(max_length=48, default="sparkles")
    accent_color        = models.CharField(max_length=16, default="#1DE394")
    requires_files      = models.BooleanField(default=False)
    supports_multimodal = models.BooleanField(default=False)
    tags                = models.JSONField(default=list)
    metadata            = models.JSONField(default=dict)
    created_by_id       = models.UUIDField(null=True, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ai"."skill'
        ordering = ("category", "codigo")

    def __str__(self) -> str:
        return f"AiSkill({self.codigo} — {self.nombre})"


# =====================================================================
# 3. AiInstruction  — ai.instruction
# =====================================================================
class AiInstruction(models.Model):
    """Directrices globales / por dominio / por rol / por agente."""

    SCOPE_CHOICES = (
        ("global", "Global"),
        ("domain", "Domain"),
        ("role",   "Role"),
        ("agent",  "Agent"),
    )

    id                = models.UUIDField(primary_key=True)
    codigo            = models.CharField(max_length=64)
    titulo            = models.CharField(max_length=160)
    contenido         = models.TextField()
    scope             = models.CharField(
        max_length=32, choices=SCOPE_CHOICES, default="global")
    domain            = models.CharField(max_length=32, null=True, blank=True)
    target_agent_id   = models.UUIDField(null=True, blank=True)
    target_role       = models.CharField(max_length=32, null=True, blank=True)
    prioridad         = models.IntegerField(default=100)
    auto_inject       = models.BooleanField(default=True)
    metadata          = models.JSONField(default=dict)
    created_by_id     = models.UUIDField(null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ai"."instruction'
        ordering = ("prioridad", "codigo")

    def __str__(self) -> str:
        return f"AiInstruction({self.codigo})"


# =====================================================================
# 4. AiThread  — ai.thread
# =====================================================================
class AiThread(models.Model):
    """Hilo de conversación. user_id = portal.mwt_user.id (UUID lógico)."""

    id                = models.UUIDField(primary_key=True)
    titulo            = models.CharField(max_length=200, default="Nuevo chat")
    user_id           = models.UUIDField()
    user_email        = models.CharField(max_length=255, null=True, blank=True)
    summary           = models.TextField(null=True, blank=True)
    pinned            = models.BooleanField(default=False)
    archived          = models.BooleanField(default=False)
    last_message_at   = models.DateTimeField(null=True, blank=True)
    message_count     = models.IntegerField(default=0)
    total_tokens_in   = models.BigIntegerField(default=0)
    total_tokens_out  = models.BigIntegerField(default=0)
    metadata          = models.JSONField(default=dict)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ai"."thread'
        ordering = ("-pinned", "-last_message_at", "-created_at")

    def __str__(self) -> str:
        return f"AiThread({self.id} — {self.titulo})"


# =====================================================================
# 5. AiThreadContext  — ai.thread_context
# =====================================================================
class AiThreadContext(models.Model):
    """Anclaje de Agentes / Skills / Instrucciones a un hilo."""

    REF_TYPE_CHOICES = (
        ("agent",       "Agent"),
        ("skill",       "Skill"),
        ("instruction", "Instruction"),
    )

    id            = models.UUIDField(primary_key=True)
    thread_id     = models.UUIDField()
    ref_type      = models.CharField(max_length=16, choices=REF_TYPE_CHOICES)
    ref_id        = models.UUIDField()
    ref_label     = models.CharField(max_length=160, null=True, blank=True)
    position      = models.IntegerField(default=0)
    pinned_by_id  = models.UUIDField(null=True, blank=True)
    pinned_at     = models.DateTimeField(auto_now_add=True)
    metadata      = models.JSONField(default=dict)

    is_active     = models.BooleanField(default=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ai"."thread_context'
        ordering = ("position", "created_at")

    def __str__(self) -> str:
        return f"AiThreadContext({self.thread_id} → {self.ref_type}:{self.ref_id})"


# =====================================================================
# 6. AiMessage  — ai.message
# =====================================================================
class AiMessage(models.Model):
    """Mensaje individual de un hilo."""

    SENDER_CHOICES = (
        ("user",      "User"),
        ("assistant", "Assistant"),
        ("system",    "System"),
        ("tool",      "Tool"),
    )
    FORMAT_CHOICES = (
        ("text",     "Text"),
        ("markdown", "Markdown"),
        ("html",     "HTML"),
        ("json",     "JSON"),
    )

    id                 = models.UUIDField(primary_key=True)
    thread_id          = models.UUIDField()
    sender             = models.CharField(max_length=16, choices=SENDER_CHOICES)
    user_id            = models.UUIDField(null=True, blank=True)
    role_label         = models.CharField(max_length=64, null=True, blank=True)
    content            = models.TextField(default="")
    content_format     = models.CharField(max_length=16, choices=FORMAT_CHOICES, default="text")
    attachments        = models.JSONField(default=list)
    context_snapshot   = models.JSONField(default=dict)
    model              = models.CharField(max_length=48, null=True, blank=True)
    tokens_in          = models.IntegerField(null=True, blank=True)
    tokens_out         = models.IntegerField(null=True, blank=True)
    latency_ms         = models.IntegerField(null=True, blank=True)
    finish_reason      = models.CharField(max_length=32, null=True, blank=True)
    error_code         = models.CharField(max_length=64, null=True, blank=True)
    error_message      = models.TextField(null=True, blank=True)
    parent_message_id  = models.UUIDField(null=True, blank=True)
    idempotence_token  = models.CharField(max_length=64, null=True, blank=True)
    metadata           = models.JSONField(default=dict)

    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ai"."message'
        ordering = ("created_at",)

    def __str__(self) -> str:
        return f"AiMessage({self.sender} @ {self.thread_id})"


# =====================================================================
# 7. AiAttachment  — ai.attachment
# =====================================================================
class AiAttachment(models.Model):
    """Adjuntos persistentes (texto extraído + binario en storage)."""

    BACKEND_CHOICES = (
        ("local", "Local"),
        ("minio", "MinIO"),
        ("s3",    "S3"),
        ("gcs",   "GCS"),
    )
    STATUS_CHOICES = (
        ("pending",    "Pending"),
        ("processing", "Processing"),
        ("ready",      "Ready"),
        ("failed",     "Failed"),
    )

    id                = models.UUIDField(primary_key=True)
    thread_id         = models.UUIDField(null=True, blank=True)
    message_id        = models.UUIDField(null=True, blank=True)
    user_id           = models.UUIDField()
    filename          = models.CharField(max_length=255)
    mime_type         = models.CharField(max_length=96)
    size_bytes        = models.BigIntegerField(default=0)
    storage_backend   = models.CharField(max_length=16, choices=BACKEND_CHOICES, default="local")
    storage_url       = models.TextField()
    storage_bucket    = models.CharField(max_length=96, null=True, blank=True)
    storage_key       = models.CharField(max_length=512, null=True, blank=True)
    sha256            = models.CharField(max_length=64, null=True, blank=True)
    extracted_text    = models.TextField(null=True, blank=True)
    extracted_chars   = models.IntegerField(null=True, blank=True)
    extracted_pages   = models.IntegerField(null=True, blank=True)
    is_image          = models.BooleanField(default=False)
    image_width       = models.IntegerField(null=True, blank=True)
    image_height      = models.IntegerField(null=True, blank=True)
    processing_status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending")
    processing_error  = models.TextField(null=True, blank=True)
    metadata          = models.JSONField(default=dict)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ai"."attachment'
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"AiAttachment({self.filename})"


# =====================================================================
# 8. AiUsageLog  — ai.usage_log  (APPEND-ONLY)
# =====================================================================
class AiUsageLog(models.Model):
    """Telemetría append-only por llamada al LLM. SIN updated_at, SIN is_active."""

    PROVIDER_CHOICES = (
        ("anthropic", "Anthropic"),
        ("openai",    "OpenAI"),
        ("google",    "Google"),
        ("mistral",   "Mistral"),
        ("local",     "Local"),
    )
    OPERATION_CHOICES = (
        ("chat",       "Chat"),
        ("embedding",  "Embedding"),
        ("vision",     "Vision"),
        ("audio",      "Audio"),
        ("completion", "Completion"),
    )

    id            = models.UUIDField(primary_key=True)
    thread_id     = models.UUIDField(null=True, blank=True)
    message_id    = models.UUIDField(null=True, blank=True)
    user_id       = models.UUIDField(null=True, blank=True)
    provider      = models.CharField(max_length=16, choices=PROVIDER_CHOICES, default="anthropic")
    model         = models.CharField(max_length=48)
    operation     = models.CharField(max_length=24, choices=OPERATION_CHOICES, default="chat")
    tokens_in     = models.IntegerField(default=0)
    tokens_out    = models.IntegerField(default=0)
    latency_ms    = models.IntegerField(null=True, blank=True)
    cost_usd      = models.DecimalField(max_digits=12, decimal_places=6, default=0)
    success       = models.BooleanField(default=True)
    error_code    = models.CharField(max_length=64, null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)
    metadata      = models.JSONField(default=dict)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'ai"."usage_log'
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"AiUsageLog({self.model} · {self.tokens_in}→{self.tokens_out})"
