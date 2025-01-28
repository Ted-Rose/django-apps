# Development logs
8. SOP windows terminal
    - `.\projects\django-apps\venv\Scripts\activate`
    - `python projects\django-apps\manage.py runserver`
7. Creating venv localy on ubuntu:
  - `pip install virtualenv`
  - `virtualenv -p /usr/bin/python3.10 venv`
  - `source venv/bin/activate`
  - `pip install -r requirements.txt`
6. Deployment on pythonanywhere:
    - `ssh-keygen -t rsa -b 4096 -C "your_email@example.com"`
        - Replace your_email@example.com with the email address associated with your GitHub account.
    - `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_rsa`
    - `cat ~/.ssh/id_rsa.pub`
        - Go to your GitHub account settings, navigate to "SSH and GPG keys," and click "New SSH key."
        - Paste the contents of your public key into the "Key" field, give it a meaningful title, and click "Add SSH key."
    - `git clone ...`
    - `mkvirtualenv venv --python=/usr/bin/python3.10`
    - `workon venv`
    - `pip install -r requirements.txt`
    - Configure apps section
        - !!! Choose `» Manual configuration (including virtualenvs)`
        - `Source code:` = `/home/FinanceConsultant/finance-consultant`
        - In `/var/www/tedisrozenfelds_pythonanywhere_com_wsgi.py` paste contents of this projects file `tedisrozenfelds_pythonanywhere_com_wsgi.py`
        - Define `Static files` in pythonanywhere:
            - `URL` = `/media/`
            - `Directory:` = `/home/TedisRozenfelds/django-apps/django/media`
5. Following [Gmail API PyDoc documentation](https://developers.google.com/resources/api-libraries/documentation/gmail/v1/python/latest/gmail_v1.users.messages.html)
4. `http://127.0.0.1:8000/` outputs authenticated Gmail labels
3. Following Google Workspace [tutorial](https://developers.google.com/gmail/api/quickstart/python)
2. `source env/bin/activate`
1. `http://127.0.0.1:8000/` outputs 'Hello, World!'
