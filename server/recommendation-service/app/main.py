import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest

from .auth import require_internal_service_key
from .config import get_settings
from .serving import RecommendationCache, RecommendationEngine
from .events import consume
from .retraining import RetrainingScheduler


@asynccontextmanager
async def lifespan(application):
    stop_event = asyncio.Event()
    retraining = RetrainingScheduler(get_settings()) if get_settings().enable_retraining else None
    if retraining:
        retraining.start()
    task = asyncio.create_task(consume(get_settings(), stop_event, retraining)) if get_settings().enable_consumer else None
    application.state.consumer_task = task
    yield
    if task:
        stop_event.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    if retraining:
        await retraining.stop()

app = FastAPI(title="ShopEase Recommendation Service", version="1.0.0", lifespan=lifespan)
app.state.engine = RecommendationEngine(get_settings().model_dir, get_settings().redis_url)
app.state.cache = RecommendationCache(get_settings().redis_url)
request_counter = Counter(
    "recommendation_service_requests_total",
    "Total authenticated requests handled by the recommendation service.",
)


@app.middleware("http")
async def count_requests(request, call_next):
    response = await call_next(request)
    if request.url.path != "/metrics":
        request_counter.inc()
    return response


@app.get("/health", dependencies=[Depends(require_internal_service_key)])
def health() -> dict[str, object]:
    return {"success": True, "service": "recommendation-service", "status": "healthy"}


@app.get(
    "/metrics",
    dependencies=[Depends(require_internal_service_key)],
    response_class=PlainTextResponse,
)
def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)


async def cached(request: Request, key: str, producer):
    value = await request.app.state.cache.get(key)
    if value is not None:
        return value
    value = producer()
    await request.app.state.cache.set(key, value)
    return value


@app.get("/recommendations/user", dependencies=[Depends(require_internal_service_key)])
async def user_recommendations(
    request: Request,
    user_id: str | None = Header(default=None, alias="x-user-id"),
    session_id: str | None = Query(default=None, alias="sessionId"),
    limit: int = Query(default=10, ge=1, le=50),
):
    if not user_id and not session_id:
        raise HTTPException(status_code=400, detail="x-user-id or sessionId is required")
    key = f"recommendation:user:{user_id or 'session:' + session_id}:{limit}"
    products = await cached(request, key, lambda: request.app.state.engine.user(user_id, session_id, limit))
    return {"success": True, "data": {"products": products}}


@app.get("/recommendations/product/{product_id}", dependencies=[Depends(require_internal_service_key)])
async def product_recommendations(
    request: Request,
    product_id: str,
    type: str = Query(default="similar", pattern="^(similar|together)$"),
    limit: int = Query(default=10, ge=1, le=50),
):
    key = f"recommendation:product:{type}:{product_id}:{limit}"
    products = await cached(request, key, lambda: request.app.state.engine.product(product_id, type, limit))
    return {"success": True, "data": {"products": products}}


@app.get("/recommendations/cart", dependencies=[Depends(require_internal_service_key)])
async def cart_recommendations(
    request: Request,
    product_ids: str = Query(default="", alias="productIds"),
    limit: int = Query(default=10, ge=1, le=50),
):
    ids = [item for item in product_ids.split(",") if item][:50]
    key = f"recommendation:cart:{','.join(sorted(set(ids)))}:{limit}"
    products = await cached(request, key, lambda: request.app.state.engine.cart(ids, limit))
    return {"success": True, "data": {"products": products}}


@app.get("/recommendations/popular", dependencies=[Depends(require_internal_service_key)])
async def popular_recommendations(
    request: Request,
    category_id: str | None = Query(default=None, alias="categoryId"),
    limit: int = Query(default=10, ge=1, le=50),
):
    key = f"recommendation:popular:{category_id or 'all'}:{limit}"
    products = await cached(request, key, lambda: request.app.state.engine.popular(category_id, limit))
    return {"success": True, "data": {"products": products}}
