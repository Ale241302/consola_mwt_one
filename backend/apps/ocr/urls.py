from django.urls import path
from .views import parse_oc, resolve_line


urlpatterns = [
    path("ocr/parse-oc/",     parse_oc,     name="ocr-parse-oc"),
    path("ocr/resolve-line/", resolve_line, name="ocr-resolve-line"),
]
