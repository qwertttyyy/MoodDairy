class RequestContext:
    def __init__(self, request):
        self.request = request
        self._user_id = None

    @property
    def user_id(self):
        return self._user_id

    @user_id.setter
    def user_id(self, user_id):
        self._user_id = user_id

r = RequestContext('request')
print(r.user_id)
r.user_id = 123
print(r.user_id)
