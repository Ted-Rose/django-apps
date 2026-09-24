from django.db import models

class Content(models.Model):
    title_lv = models.CharField(max_length=500)
    title_eng = models.CharField(max_length=500)
    type = models.CharField(max_length=100)
    description_lv = models.TextField(blank=True, null=True)
    description_eng = models.TextField(blank=True, null=True)
    image = models.URLField(blank=True, null=True)
    url = models.URLField()
    content_rating = models.CharField(max_length=50, blank=True, null=True)
    rating_value = models.FloatField(blank=True, null=True)
    start_date = models.DateField(blank=True, null=True)
    channel = models.CharField(max_length=100)
    ratio = models.FloatField(blank=True, null=True)

    def __str__(self):
        return (
            f"{self.title_lv} ({self.type}) - "
            f"Rating: {self.rating_value}"
        )
