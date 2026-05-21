"""
Base Kafka consumer utilities.

Uses confluent-kafka which wraps librdkafka for production-grade throughput
and back-pressure handling.
"""
import json
import logging
import os
import signal
import time
from typing import Callable

from confluent_kafka import Consumer, KafkaError, KafkaException

logger = logging.getLogger(__name__)

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka:9092")


def make_consumer(group_id: str, topics: list[str]) -> Consumer:
    """Create and subscribe a confluent-kafka Consumer."""
    cfg = {
        "bootstrap.servers": KAFKA_BROKERS,
        "group.id": group_id,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,          # manual commit after processing
        "session.timeout.ms": 30_000,
        "heartbeat.interval.ms": 5_000,
        "max.poll.interval.ms": 300_000,
        "fetch.min.bytes": 1,
        "fetch.wait.max.ms": 500,
    }
    consumer = Consumer(cfg)
    consumer.subscribe(topics)
    logger.info("subscribed to topics %s (group=%s)", topics, group_id)
    return consumer


def run_consumer(
    consumer: Consumer,
    handler: Callable[[str, dict], None],
    *,
    poll_timeout: float = 1.0,
    batch_size: int = 100,
) -> None:
    """
    Main event loop. Polls Kafka, calls `handler(topic, payload)` for each
    message, then commits. Handles graceful shutdown on SIGTERM/SIGINT.
    """
    running = True

    def _stop(*_):
        nonlocal running
        logger.info("shutdown signal received")
        running = False

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    logger.info("consumer loop started (batch_size=%d)", batch_size)
    while running:
        try:
            msgs = consumer.consume(num_messages=batch_size, timeout=poll_timeout)
        except KafkaException as exc:
            logger.error("kafka consume error: %s", exc)
            time.sleep(1)
            continue

        for msg in msgs:
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error("kafka message error: %s", msg.error())
                continue

            topic = msg.topic()
            try:
                payload = json.loads(msg.value().decode("utf-8"))
                handler(topic, payload)
                consumer.commit(message=msg, asynchronous=False)
            except Exception as exc:
                logger.exception("handler failed for topic=%s offset=%s: %s", topic, msg.offset(), exc)
                # Do NOT commit — message will be reprocessed after consumer restart
                time.sleep(0.5)

    logger.info("consumer loop stopped, closing connection")
    consumer.close()
