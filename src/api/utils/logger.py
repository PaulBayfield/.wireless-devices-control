import logging


class Logger:
    """
    Application logger
    """

    def __init__(self, name: str) -> None:
        """
        Initialize the logger
        """
        self.logger = logging.getLogger(f"WirelessAPI - {name}")
        self.logger.setLevel(logging.DEBUG)

        handler = logging.StreamHandler()
        dt_fmt = "%Y-%m-%d %H:%M:%S"
        formatter = logging.Formatter(
            "[{asctime}] [{levelname:<8}] {name}: {message}", dt_fmt, style="{"
        )
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)

        self.logger.info("Logger initialized!")

    def info(self, message: str) -> None:
        self.logger.info(message)

    def warning(self, message: str) -> None:
        self.logger.warning(message)

    def error(self, message: str) -> None:
        self.logger.error(message)

    def critical(self, message: str) -> None:
        self.logger.critical(message)

    def debug(self, message: str) -> None:
        self.logger.debug(message)
