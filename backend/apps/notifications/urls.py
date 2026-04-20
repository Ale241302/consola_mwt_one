from rest_framework.routers import DefaultRouter
from .views import NotificationLogViewSet, CollectionLogViewSet

router = DefaultRouter()
router.register(r"notification-logs", NotificationLogViewSet, basename="notification-logs")
router.register(r"collection-logs",   CollectionLogViewSet,   basename="collection-logs")
urlpatterns = router.urls
