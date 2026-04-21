from rest_framework.routers import DefaultRouter
from .views import (
    NotificationLogViewSet, CollectionLogViewSet,
    GraceDaysCatViewSet, EmailQueueLogViewSet,
)

router = DefaultRouter()
router.register(r"notification-logs",   NotificationLogViewSet, basename="notification-logs")
router.register(r"collection-logs",     CollectionLogViewSet,   basename="collection-logs")
router.register(r"grace-days",          GraceDaysCatViewSet,    basename="grace-days")
router.register(r"email-queue-log",     EmailQueueLogViewSet,   basename="email-queue-log")
urlpatterns = router.urls
