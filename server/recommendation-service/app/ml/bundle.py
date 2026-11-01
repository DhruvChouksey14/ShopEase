class Bundle:
    def __init__(self, collaborative, content, interactions=None, products=None, hybrid_weights=None):
        self.collaborative = collaborative
        self.content = content
        self.interactions = interactions
        self.products = products
        self.hybrid_weights = hybrid_weights

    def save(self, path):
        import joblib

        joblib.dump(self, path)
